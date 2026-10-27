/**
 * BACKEND TRACKER COMPLETO - INTEGRAÇÃO KIWIFY, CACKTO, GREEN & META CAPI
 * Pronto para rodar no Render, Railway ou VPS
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const Database = require('better-sqlite3');

const app = express();
app.use(cors());
app.use(express.json());

// CONFIGURAÇÃO DA META CONVERSIONS API (CAPI)
const META_PIXEL_ID = process.env.META_PIXEL_ID || "SEU_PIXEL_ID";
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || "SEU_ACCESS_TOKEN";

// Banco SQLite ultra leve e rápido (sem custo de banco na nuvem)
const db = new Database('tracker.db');
db.exec(`
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
    country TEXT,
    city TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tax_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    meta_tax_pct REAL DEFAULT 12.50,
    empresa_tax_pct REAL DEFAULT 0.00,
    plat_tax_pct REAL DEFAULT 8.99,
    plat_tax_fix REAL DEFAULT 2.49,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  INSERT OR IGNORE INTO tax_settings (id, meta_tax_pct, empresa_tax_pct, plat_tax_pct, plat_tax_fix)
  VALUES (1, 12.50, 0.00, 8.99, 2.49);

  CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    name TEXT,
    action_type TEXT,
    target TEXT,
    condition_text TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

function calculateNetAmount(grossAmount) {
  const settings = db.prepare('SELECT * FROM tax_settings WHERE id = 1').get();
  const platTax = (grossAmount * (settings.plat_tax_pct / 100)) + settings.plat_tax_fix;
  const net = grossAmount - platTax;
  return Math.max(0, net);
}

// Utilitário para quebrar a string de SCK no formato:
// source|campaignName|campaignId|adsetName|adsetId|adName|adId|placement
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
  
  // Se vier com separadores de pipeline gerados pelo Facebook Ads
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

  // Normalização caso a campanha venha no formato "Nome|ID"
  if (result.utm_campaign && result.utm_campaign.includes('|')) {
    const cParts = result.utm_campaign.split('|');
    result.utm_campaign = cParts[0];
    result.campaign_id = cParts[1] || result.campaign_id;
  }

  if (result.utm_content && result.utm_content.includes('|')) {
    const aParts = result.utm_content.split('|');
    result.utm_content = aParts[0];
    result.ad_id = aParts[1] || result.ad_id;
  }

  return result;
}

// Endpoint para ler e salvar configurações de taxas
app.get('/api/v1/taxes', (req, res) => {
  const settings = db.prepare('SELECT * FROM tax_settings WHERE id = 1').get();
  res.json(settings);
});

app.post('/api/v1/taxes', (req, res) => {
  const { meta_tax_pct, empresa_tax_pct, plat_tax_pct, plat_tax_fix } = req.body;
  db.prepare(`
    UPDATE tax_settings 
    SET meta_tax_pct = ?, empresa_tax_pct = ?, plat_tax_pct = ?, plat_tax_fix = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(meta_tax_pct, empresa_tax_pct, plat_tax_pct, plat_tax_fix);

  res.json({ success: true });
});

function sha256(val) {
  if (!val) return null;
  return crypto.createHash('sha256').update(val.trim().toLowerCase()).digest('hex');
}

// Disparador Meta CAPI
async function sendMetaPurchase(sale, req) {
  if (!META_PIXEL_ID || META_PIXEL_ID === "SEU_PIXEL_ID") return;
  const url = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;
  
  try {
    await axios.post(url, {
      data: [{
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: sale.id, // Deduplicação
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

// =================================================================
// 1. WEBHOOK KIWIFY (https://seu-dominio.com/api/v1/webhook/kiwify)
// =================================================================
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

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sales (
      id, platform, customer_name, customer_email, amount, net_amount, status, 
      utm_source, utm_campaign, campaign_id, utm_medium, adset_id, utm_content, ad_id, utm_term, sck
    ) VALUES (?, 'kiwify', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    saleId, name, email, amount, netAmount, status, 
    tracking.utm_source, tracking.utm_campaign, tracking.campaign_id,
    tracking.utm_medium, tracking.adset_id,
    tracking.utm_content, tracking.ad_id,
    tracking.utm_term, sckRaw
  );

  if (status === 'approved') {
    await sendMetaPurchase({ id: saleId, customer_email: email, amount }, req);
  }

  console.log(`[Kiwify] Venda ID: ${saleId} - Campanha: ${tracking.utm_campaign} - Criativo: ${tracking.utm_content}`);
  return res.status(200).json({ received: true });
});

// =================================================================
// 2. WEBHOOK CACKTO (https://seu-dominio.com/api/v1/webhook/cackto)
// =================================================================
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

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sales (
      id, platform, customer_name, customer_email, amount, net_amount, status, 
      utm_source, utm_campaign, campaign_id, utm_medium, adset_id, utm_content, ad_id, utm_term, sck
    ) VALUES (?, 'cackto', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    saleId, name, email, amount, netAmount, status,
    tracking.utm_source, tracking.utm_campaign, tracking.campaign_id,
    tracking.utm_medium, tracking.adset_id,
    tracking.utm_content, tracking.ad_id,
    tracking.utm_term, sckRaw
  );

  if (status === 'approved') {
    await sendMetaPurchase({ id: saleId, customer_email: email, amount }, req);
  }

  return res.status(200).json({ received: true });
});

// =================================================================
// 3. WEBHOOK GREEN (https://seu-dominio.com/api/v1/webhook/green)
// =================================================================
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

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sales (
      id, platform, customer_name, customer_email, amount, net_amount, status, 
      utm_source, utm_campaign, campaign_id, utm_medium, adset_id, utm_content, ad_id, utm_term, sck
    ) VALUES (?, 'green', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    saleId, name, email, amount, netAmount, status,
    tracking.utm_source, tracking.utm_campaign, tracking.campaign_id,
    tracking.utm_medium, tracking.adset_id,
    tracking.utm_content, tracking.ad_id,
    tracking.utm_term, sckRaw
  );

  if (status === 'approved') {
    await sendMetaPurchase({ id: saleId, customer_email: email, amount }, req);
  }

  return res.status(200).json({ received: true });
});

// Endpoint para abastecer o dashboard
app.get('/api/v1/sales', (req, res) => {
  const rows = db.prepare('SELECT * FROM sales ORDER BY created_at DESC LIMIT 100').all();
  res.json({ sales: rows });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SF Tracker IA rodando na porta ${PORT}`));