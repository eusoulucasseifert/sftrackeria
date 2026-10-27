/**
 * BACKEND SF TRACKER IA - INTEGRAÇÃO KIWIFY, CACKTO, GREEN & META CAPI
 * Compatível nativamente com Node 20 / 22 / 24 (Zero compilação C++)
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Suporte nativo ao SQLite (Node 22+) ou fallback para banco JSON leve
let dbSync = null;
try {
  const { DatabaseSync, Database } = require('node:sqlite');
  const DBClass = DatabaseSync || Database;
  if (DBClass) {
    dbSync = new DBClass(path.resolve(process.cwd(), 'tracker.db'));
  }
} catch (e) {
  console.log('[INFO] Utilizando engine leve de persistência.');
}

const app = express();
app.use(cors());
app.use(express.json());

// CONFIGURAÇÃO DA META CONVERSIONS API (CAPI)
const META_PIXEL_ID = process.env.META_PIXEL_ID || "SEU_PIXEL_ID";
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || "SEU_ACCESS_TOKEN";

// Inicialização da Tabela SQLite (se disponível) ou Estrutura em Memória/Arquivo
const JSON_DB_FILE = path.resolve(process.cwd(), 'sales_data.json');
let memoryData = {
  sales: [],
  taxes: {
    meta_tax_pct: 12.50,
    empresa_tax_pct: 0.00,
    plat_tax_pct: 8.99,
    plat_tax_fix: 2.49
  }
};

if (fs.existsSync(JSON_DB_FILE)) {
  try {
    memoryData = JSON.parse(fs.readFileSync(JSON_DB_FILE, 'utf8'));
  } catch (err) {}
}

function persistMemory() {
  try {
    fs.writeFileSync(JSON_DB_FILE, JSON.stringify(memoryData, null, 2));
  } catch (err) {}
}

if (dbSync) {
  try {
    dbSync.exec(`
      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY,
        platform TEXT,
        customer_name TEXT,
        customer_email TEXT,
        amount REAL,
        net_amount REAL,
        status TEXT,
        utm_source TEXT,
        utm_campaign TEXT,
        campaign_id TEXT,
        utm_medium TEXT,
        adset_id TEXT,
        utm_content TEXT,
        ad_id TEXT,
        utm_term TEXT,
        sck TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tax_settings (
        id INTEGER PRIMARY KEY,
        meta_tax_pct REAL DEFAULT 12.50,
        empresa_tax_pct REAL DEFAULT 0.00,
        plat_tax_pct REAL DEFAULT 8.99,
        plat_tax_fix REAL DEFAULT 2.49
      );

      INSERT OR IGNORE INTO tax_settings (id, meta_tax_pct, empresa_tax_pct, plat_tax_pct, plat_tax_fix)
      VALUES (1, 12.50, 0.00, 8.99, 2.49);
    `);
  } catch (e) {
    console.warn('[DB WARNING]', e.message);
  }
}

function getTaxes() {
  if (dbSync) {
    try {
      const row = dbSync.prepare('SELECT * FROM tax_settings WHERE id = 1').get();
      if (row) return row;
    } catch (e) {}
  }
  return memoryData.taxes;
}

function calculateNetAmount(grossAmount) {
  const settings = getTaxes();
  const platTax = (grossAmount * (settings.plat_tax_pct / 100)) + settings.plat_tax_fix;
  const net = grossAmount - platTax;
  return Math.max(0, net);
}

function parseTrackingSCK(sckString, bodyParams = {}) {
  let result = {
    utm_source: bodyParams.utm_source || 'direct',
    utm_campaign: bodyParams.utm_campaign || '',
    campaign_id: '',
    utm_medium: bodyParams.utm_medium || '',
    adset_id: '',
    utm_content: bodyParams.utm_content || '',
    ad_id: '',
    utm_term: bodyParams.utm_term || ''
  };

  if (!sckString) return result;
  const parts = sckString.split('|');

  if (parts.length >= 2) {
    result.utm_source = parts[0] || result.utm_source;
    result.utm_campaign = parts[1] || result.utm_campaign;
    result.campaign_id = parts[2] || '';
    result.utm_medium = parts[3] || result.utm_medium;
    result.adset_id = parts[4] || '';
    result.utm_content = parts[5] || result.utm_content;
    result.ad_id = parts[6] || '';
    result.utm_term = parts[7] || result.utm_term;
  }

  return result;
}

function saveSale(saleData) {
  if (dbSync) {
    try {
      const stmt = dbSync.prepare(`
        INSERT OR REPLACE INTO sales (
          id, platform, customer_name, customer_email, amount, net_amount, status,
          utm_source, utm_campaign, campaign_id, utm_medium, adset_id, utm_content, ad_id, utm_term, sck
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        saleData.id, saleData.platform, saleData.customer_name, saleData.customer_email,
        saleData.amount, saleData.net_amount, saleData.status,
        saleData.utm_source, saleData.utm_campaign, saleData.campaign_id,
        saleData.utm_medium, saleData.adset_id,
        saleData.utm_content, saleData.ad_id,
        saleData.utm_term, saleData.sck
      );
      return;
    } catch (e) {}
  }

  // Fallback seguro em JSON
  const existingIdx = memoryData.sales.findIndex(s => s.id === saleData.id);
  if (existingIdx >= 0) {
    memoryData.sales[existingIdx] = saleData;
  } else {
    memoryData.sales.unshift(saleData);
  }
  persistMemory();
}

function sha256(val) {
  if (!val) return null;
  return crypto.createHash('sha256').update(val.trim().toLowerCase()).digest('hex');
}

async function sendMetaPurchase(sale, req) {
  if (!META_PIXEL_ID || META_PIXEL_ID === "SEU_PIXEL_ID") return;
  const url = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;

  try {
    await axios.post(url, {
      data: [{
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: sale.id,
        action_source: 'website',
        user_data: {
          em: [sha256(sale.customer_email)],
          client_ip_address: req.ip,
          client_user_agent: req.headers['user-agent']
        },
        custom_data: {
          currency: 'BRL',
          value: Number(sale.amount)
        }
      }]
    });
  } catch (e) {
    console.error('[CAPI ERRO]', e.response ? e.response.data : e.message);
  }
}

// ENDPOINTS DE CONFIGURAÇÃO DE TAXAS
app.get('/api/v1/taxes', (req, res) => {
  res.json(getTaxes());
});

app.post('/api/v1/taxes', (req, res) => {
  const { meta_tax_pct, empresa_tax_pct, plat_tax_pct, plat_tax_fix } = req.body;
  if (dbSync) {
    try {
      dbSync.prepare(`
        UPDATE tax_settings 
        SET meta_tax_pct = ?, empresa_tax_pct = ?, plat_tax_pct = ?, plat_tax_fix = ?
        WHERE id = 1
      `).run(meta_tax_pct, empresa_tax_pct, plat_tax_pct, plat_tax_fix);
    } catch (e) {}
  }
  memoryData.taxes = { meta_tax_pct, empresa_tax_pct, plat_tax_pct, plat_tax_fix };
  persistMemory();
  res.json({ success: true });
});

// WEBHOOK KIWIFY
app.post('/api/v1/webhook/kiwify', async (req, res) => {
  const body = req.body;
  const saleId = body.order_id || body.order_ref || 'kw_' + Date.now();
  const name = body.Customer?.full_name || body.Customer?.name || 'Cliente';
  const email = body.Customer?.email || '';
  const amount = Number(body.Order?.order_total || body.order_amount || 0) / (body.Order?.order_total > 500 ? 100 : 1);
  const status = (body.order_status === 'paid' || body.event === 'order_approved') ? 'approved' : 'pending';
  const netAmount = calculateNetAmount(amount);

  const sckRaw = body.TrackingParameters?.sck || body.TrackingParameters?.src || '';
  const tracking = parseTrackingSCK(sckRaw, body.TrackingParameters || {});

  saveSale({
    id: saleId, platform: 'kiwify', customer_name: name, customer_email: email,
    amount, net_amount: netAmount, status, ...tracking, sck: sckRaw,
    created_at: new Date().toISOString()
  });

  if (status === 'approved') {
    await sendMetaPurchase({ id: saleId, customer_email: email, amount }, req);
  }

  return res.status(200).json({ received: true });
});

// WEBHOOK CACKTO
app.post('/api/v1/webhook/cackto', async (req, res) => {
  const body = req.body;
  const saleId = body.transaction_id || body.order_id || 'ck_' + Date.now();
  const name = body.customer?.name || body.name || 'Cliente';
  const email = body.customer?.email || body.email || '';
  const amount = Number(body.amount || body.price || 0);
  const netAmount = calculateNetAmount(amount);
  const status = (body.status === 'paid' || body.event === 'sale.approved') ? 'approved' : 'pending';

  const sckRaw = body.sck || body.src || body.tracking_parameters?.sck || '';
  const tracking = parseTrackingSCK(sckRaw, body.tracking_parameters || {});

  saveSale({
    id: saleId, platform: 'cackto', customer_name: name, customer_email: email,
    amount, net_amount: netAmount, status, ...tracking, sck: sckRaw,
    created_at: new Date().toISOString()
  });

  if (status === 'approved') {
    await sendMetaPurchase({ id: saleId, customer_email: email, amount }, req);
  }

  return res.status(200).json({ received: true });
});

// WEBHOOK GREEN
app.post('/api/v1/webhook/green', async (req, res) => {
  const body = req.body;
  const saleId = body.sale?.id || body.transaction || 'gr_' + Date.now();
  const name = body.client?.name || body.buyer?.name || 'Cliente';
  const email = body.client?.email || body.buyer?.email || '';
  const amount = Number(body.sale?.amount || body.value || 0);
  const netAmount = calculateNetAmount(amount);
  const status = (body.event === 'SALE_APPROVED' || body.status === 'approved') ? 'approved' : 'pending';

  const sckRaw = body.sale?.sck || body.sck || '';
  const tracking = parseTrackingSCK(sckRaw, body.sale || {});

  saveSale({
    id: saleId, platform: 'green', customer_name: name, customer_email: email,
    amount, net_amount: netAmount, status, ...tracking, sck: sckRaw,
    created_at: new Date().toISOString()
  });

  if (status === 'approved') {
    await sendMetaPurchase({ id: saleId, customer_email: email, amount }, req);
  }

  return res.status(200).json({ received: true });
});

// LISTA DE VENDAS PARA O DASHBOARD
app.get('/api/v1/sales', (req, res) => {
  if (dbSync) {
    try {
      const rows = dbSync.prepare('SELECT * FROM sales ORDER BY created_at DESC LIMIT 100').all();
      return res.json({ sales: rows });
    } catch (e) {}
  }
  res.json({ sales: memoryData.sales.slice(0, 100) });
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'SF TRACKER IA API' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SF Tracker IA API operacional na porta ${PORT}`));
