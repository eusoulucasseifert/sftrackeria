/**
 * BACKEND SF TRACKER IA - SISTEMA COMPLETO DE ATRIBUIÇÃO & SINCRONIZAÇÃO EM TEMPO REAL
 * Compatível nativamente com Node 20 / 22 / 24 no Render/Railway
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// BANCO DE DADOS EM ARQUIVO JSON ROBUSTO COM FALLBACK AUTOMÁTICO
const DB_FILE = path.resolve(process.cwd(), 'database_sf.json');

const defaultDb = {
  users: {
    default_user: {
      meta_pixel_id: '',
      meta_access_token: '',
      taxes: {
        meta_tax_pct: 12.50,
        empresa_tax_pct: 0.00,
        plat_tax_pct: 8.99,
        plat_tax_fix: 2.49
      },
      sound_preferences: {
        sound_enabled: true,
        sound_style: 'coins_cashier',
        hide_product_name: true,
        vibration_enabled: true
      },
      rules: [
        { id: 1, name: 'Stop-Loss R$ 50', action: 'Pausar', condition: 'Spend > R$ 50,00 e Vendas < 1', status: 'Ativo', lastRun: 'Há 5 min' },
        { id: 2, name: 'Escala Automática +20%', action: 'Aumentar Orçamento 20%', condition: 'Vendas >= 3 e CPA <= R$ 25,00', status: 'Ativo', lastRun: 'Há 12 min' },
        { id: 3, name: 'Proteger Margem', action: 'Diminuir Orçamento 30%', condition: 'CPA > R$ 45,00', status: 'Ativo', lastRun: 'Hoje 14:30' },
        { id: 4, name: 'Reset Orçamento Base', action: 'Definir R$ 100,00', condition: 'Todo dia às 23:00', status: 'Ativo', lastRun: 'Ontem 23:00' }
      ]
    }
  },
  sales: [],
  visits: []
};

let db = defaultDb;
if (fs.existsSync(DB_FILE)) {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    db = JSON.parse(raw);
    if (!db.users) db.users = defaultDb.users;
    if (!db.sales) db.sales = [];
    if (!db.visits) db.visits = [];
  } catch (e) {
    db = defaultDb;
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('[ERRO SALVAR DB]', err.message);
  }
}

// Retorna ou inicializa o usuário
function getUserProfile(userId = 'default_user') {
  if (!db.users[userId]) {
    db.users[userId] = JSON.parse(JSON.stringify(defaultDb.users.default_user));
    saveDb();
  }
  return db.users[userId];
}

// CÁLCULO DE VALOR LÍQUIDO COM BASE NAS TAXAS DO USUÁRIO
function calculateNetAmount(grossAmount, userId = 'default_user') {
  const user = getUserProfile(userId);
  const taxes = user.taxes || defaultDb.users.default_user.taxes;
  const platTax = (grossAmount * (taxes.plat_tax_pct / 100)) + taxes.plat_tax_fix;
  const net = grossAmount - platTax;
  return Math.max(0, net);
}

// TRATAMENTO UNIFICADO DE UTMs E SCK
function parseTrackingSCK(sckString, params = {}) {
  let result = {
    utm_source: params.utm_source || 'direct',
    utm_campaign: params.utm_campaign || '',
    campaign_id: '',
    utm_medium: params.utm_medium || '',
    adset_id: '',
    utm_content: params.utm_content || '',
    ad_id: '',
    utm_term: params.utm_term || ''
  };

  if (!sckString) return result;
  const parts = String(sckString).split('|');
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

// DISPARO SEGURO DA META CONVERSIONS API (CAPI)
function sha256(val) {
  if (!val) return null;
  return crypto.createHash('sha256').update(String(val).trim().toLowerCase()).digest('hex');
}

async function sendMetaPurchase(sale, req, userId = 'default_user') {
  const user = getUserProfile(userId);
  const pixelId = user.meta_pixel_id || process.env.META_PIXEL_ID;
  const accessToken = user.meta_access_token || process.env.META_ACCESS_TOKEN;

  if (!pixelId || !accessToken || pixelId === 'SEU_PIXEL_ID') {
    return;
  }

  const url = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`;
  try {
    await axios.post(url, {
      data: [{
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: String(sale.id),
        action_source: 'website',
        user_data: {
          em: [sha256(sale.customer_email)],
          client_ip_address: req ? req.ip : undefined,
          client_user_agent: req ? req.headers['user-agent'] : undefined
        },
        custom_data: {
          currency: 'BRL',
          value: Number(sale.amount)
        }
      }]
    });
    console.log(`[CAPI SUCESSO] Compra ${sale.id} enviada para Meta Pixel ${pixelId}`);
  } catch (e) {
    console.error('[CAPI ERRO]', e.response ? e.response.data : e.message);
  }
}

// INSERÇÃO/ATUALIZAÇÃO DE VENDA
function recordSale(saleData, req, userId = 'default_user') {
  const index = db.sales.findIndex(s => s.id === saleData.id);
  const enriched = {
    ...saleData,
    userId: userId,
    updated_at: new Date().toISOString()
  };

  if (index >= 0) {
    db.sales[index] = { ...db.sales[index], ...enriched };
  } else {
    db.sales.unshift(enriched);
  }

  // Mantém os últimos 500 registros para garantir alta performance
  if (db.sales.length > 500) {
    db.sales = db.sales.slice(0, 500);
  }

  saveDb();

  if (saleData.status === 'approved') {
    sendMetaPurchase(saleData, req, userId).catch(() => {});
  }
  return enriched;
}

// ==========================================
// ROTAS DE CONFIGURAÇÃO DO USUÁRIO (PERSISTENTE)
// ==========================================

// Obter configurações completas do usuário
app.get('/api/v1/user/settings', (req, res) => {
  const userId = req.query.userId || 'default_user';
  const profile = getUserProfile(userId);
  return res.json({ success: true, settings: profile });
});

// Salvar Taxas e Impostos
app.post('/api/v1/taxes', (req, res) => {
  const { userId = 'default_user', meta_tax_pct, empresa_tax_pct, plat_tax_pct, plat_tax_fix } = req.body;
  const profile = getUserProfile(userId);

  profile.taxes = {
    meta_tax_pct: parseFloat(meta_tax_pct) || 0,
    empresa_tax_pct: parseFloat(empresa_tax_pct) || 0,
    plat_tax_pct: parseFloat(plat_tax_pct) || 0,
    plat_tax_fix: parseFloat(plat_tax_fix) || 0
  };

  saveDb();
  return res.status(200).json({ success: true, taxes: profile.taxes });
});

// Salvar Credenciais da Meta (Pixel + Token)
app.post('/api/v1/user/meta', (req, res) => {
  const { userId = 'default_user', meta_pixel_id, meta_access_token } = req.body;
  const profile = getUserProfile(userId);

  profile.meta_pixel_id = String(meta_pixel_id || '').trim();
  profile.meta_access_token = String(meta_access_token || '').trim();

  saveDb();
  return res.status(200).json({ success: true, meta_pixel_id: profile.meta_pixel_id });
});

// Salvar Preferências de Notificação e Som
app.post('/api/v1/user/notifications', (req, res) => {
  const { userId = 'default_user', sound_enabled, sound_style, hide_product_name, vibration_enabled } = req.body;
  const profile = getUserProfile(userId);

  profile.sound_preferences = {
    sound_enabled: Boolean(sound_enabled),
    sound_style: sound_style || 'coins_cashier',
    hide_product_name: Boolean(hide_product_name),
    vibration_enabled: Boolean(vibration_enabled)
  };

  saveDb();
  return res.status(200).json({ success: true, sound_preferences: profile.sound_preferences });
});

// ==========================================
// ROTAS DE SINCRONIZAÇÃO EM TEMPO REAL
// ==========================================

// Retorna todas as vendas com filtro de último timestamp para sincronização instantânea
app.get('/api/v1/sales', (req, res) => {
  const since = req.query.since;
  let items = db.sales;

  if (since) {
    items = db.sales.filter(s => new Date(s.updated_at || s.created_at) > new Date(since));
  }

  return res.json({
    success: true,
    server_time: new Date().toISOString(),
    total: db.sales.length,
    sales: items.slice(0, 100)
  });
});

// Limpar dados para teste
app.post('/api/v1/sales/reset', (req, res) => {
  db.sales = [];
  saveDb();
  return res.json({ success: true, message: 'Histórico resetado com sucesso' });
});

// ==========================================
// WEBHOOKS OFICIAIS (CACKTO, KIWIFY, GREEN)
// ==========================================

// Webhook Cackto / Cakto Pay
app.post(['/api/v1/webhook/cackto', '/api/v1/webhook/cakto'], (req, res) => {
  try {
    const raw = req.body || {};
    const body = raw.data || raw;

    const saleId = body.transaction_id || body.id || body.order_id || 'ck_' + Date.now();
    const name = body.customer?.name || body.name || body.client?.name || 'Cliente Cakto';
    const email = body.customer?.email || body.email || body.client?.email || '';

    let amount = Number(body.amount ?? body.price ?? body.value ?? 37.99);
    if (amount > 500 && !body.is_decimal) {
      if (raw.event && raw.event.includes('test')) amount = amount / 100;
    }
    if (isNaN(amount) || amount <= 0) amount = 37.99;

    const netAmount = calculateNetAmount(amount);
    const eventName = String(raw.event || body.event || body.status || '').toLowerCase();
    const isApproved = eventName.includes('approved') || eventName.includes('pago') || eventName.includes('paid') || eventName.includes('test') || eventName.includes('purchase');
    const status = isApproved ? 'approved' : 'pending';

    const sckRaw = body.sck || body.src || body.tracking_parameters?.sck || raw.sck || '';
    const tracking = parseTrackingSCK(sckRaw, body.tracking_parameters || body);

    recordSale({
      id: String(saleId),
      platform: 'cackto',
      customer_name: name,
      customer_email: email,
      amount: amount,
      net_amount: netAmount,
      status: status,
      ...tracking,
      sck: sckRaw,
      created_at: new Date().toISOString()
    }, req);

    return res.status(200).json({ success: true, received: true });
  } catch (err) {
    console.error('[ERRO CACKTO WEBHOOK]', err.message);
    return res.status(200).json({ success: true, fallback: true });
  }
});

// Webhook Kiwify
app.post('/api/v1/webhook/kiwify', (req, res) => {
  try {
    const body = req.body || {};
    const order = body.order || body;

    const saleId = order.order_id || order.id || 'kw_' + Date.now();
    const name = order.Customer?.full_name || order.Customer?.name || 'Cliente Kiwify';
    const email = order.Customer?.email || '';
    const amount = Number(order.order_amount ? (order.order_amount / 100) : (order.amount || 37.99));
    const netAmount = calculateNetAmount(amount);

    const orderStatus = String(order.order_status || body.order_status || '').toLowerCase();
    const status = (orderStatus === 'paid' || orderStatus === 'approved') ? 'approved' : 'pending';

    const sckRaw = order.TrackingParameters?.sck || order.TrackingParameters?.src || body.sck || '';
    const tracking = parseTrackingSCK(sckRaw, order.TrackingParameters || {});

    recordSale({
      id: String(saleId),
      platform: 'kiwify',
      customer_name: name,
      customer_email: email,
      amount: amount,
      net_amount: netAmount,
      status: status,
      ...tracking,
      sck: sckRaw,
      created_at: new Date().toISOString()
    }, req);

    return res.status(200).json({ success: true, received: true });
  } catch (err) {
    console.error('[ERRO KIWIFY WEBHOOK]', err.message);
    return res.status(200).json({ success: true, fallback: true });
  }
});

// Webhook Green (Greenn)
app.post('/api/v1/webhook/green', (req, res) => {
  try {
    const body = req.body || {};
    const saleId = body.sale?.id || body.transaction || 'gr_' + Date.now();
    const name = body.client?.name || body.buyer?.name || 'Cliente Green';
    const email = body.client?.email || body.buyer?.email || '';
    const amount = Number(body.sale?.amount || body.value || 37.99);
    const netAmount = calculateNetAmount(amount);
    const status = (body.event === 'SALE_APPROVED' || body.status === 'approved') ? 'approved' : 'pending';

    const sckRaw = body.sale?.sck || body.sck || '';
    const tracking = parseTrackingSCK(sckRaw, body.sale || {});

    recordSale({
      id: String(saleId),
      platform: 'green',
      customer_name: name,
      customer_email: email,
      amount: amount,
      net_amount: netAmount,
      status: status,
      ...tracking,
      sck: sckRaw,
      created_at: new Date().toISOString()
    }, req);

    return res.status(200).json({ success: true, received: true });
  } catch (err) {
    console.error('[ERRO GREEN WEBHOOK]', err.message);
    return res.status(200).json({ success: true, fallback: true });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'SF TRACKER IA API', time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[SF TRACKER IA] Servidor operacional na porta ${PORT}`));
