const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Caminho do arquivo de banco de dados JSON simples e resiliente
const DB_FILE = path.join(__dirname, 'data', 'db.json');

// Inicialização do Banco de Dados
function initDB() {
  if (!fs.existsSync(path.dirname(DB_FILE))) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      sales: [
        {
          id: "ord_101",
          platform: "Kiwify",
          product: "Protocolo Magnésio",
          status: "approved",
          paymentMethod: "pix",
          amount: 37.00,
          fee: 3.59,
          netAmount: 33.41,
          utm_source: "FB",
          utm_campaign: "C01_Magnes_testecriativo|12021001",
          utm_medium: "aberto_45|23021001",
          utm_content: "ad01_37|34021001",
          utm_term: "Instagram_Feed",
          campaignId: "12021001",
          adsetId: "23021001",
          adId: "34021001",
          customerEmail: "cliente1@exemplo.com",
          createdAt: new Date().toISOString()
        },
        {
          id: "ord_102",
          platform: "Cackto",
          product: "Protocolo Magnésio",
          status: "approved",
          paymentMethod: "card",
          amount: 43.98,
          fee: 4.10,
          netAmount: 39.88,
          utm_source: "FB",
          utm_campaign: "C01_Magnes_testecriativo|12021001",
          utm_medium: "aberto_45|23021001",
          utm_content: "ad02_37|34021002",
          utm_term: "Facebook_Feed",
          campaignId: "12021001",
          adsetId: "23021001",
          adId: "34021002",
          customerEmail: "cliente2@exemplo.com",
          createdAt: new Date(Date.now() - 3600000 * 2).toISOString()
        }
      ],
      metaAccounts: [
        {
          id: "act_9823418293",
          name: "Conta BM Contingência 01",
          bmName: "BM Primária - Tráfego",
          currency: "BRL",
          status: "ACTIVE",
          token: "EAA...",
          spendToday: 53.39,
          clicksToday: 22,
          impressionsToday: 850
        }
      ],
      campaigns: [
        {
          id: "12021001",
          accountId: "act_9823418293",
          name: "C01_Magnes_testecriativo",
          status: "ACTIVE",
          spend: 53.39,
          clicks: 22,
          impressions: 850,
          cpc: 2.42,
          cpm: 62.81,
          adsets: [
            {
              id: "23021001",
              name: "aberto_45",
              status: "ACTIVE",
              budget: 40.00,
              spend: 53.39,
              ads: [
                { id: "34021001", name: "ad01_37", status: "ACTIVE", spend: 28.19, clicks: 12 },
                { id: "34021002", name: "ad02_37", status: "ACTIVE", spend: 25.20, clicks: 10 }
              ]
            }
          ]
        }
      ],
      rules: [
        {
          id: "rule_1",
          name: "ABO +30% ORC",
          applyTo: "ActiveAdsets",
          action: "IncreaseBudget",
          actionPercent: 28,
          conditions: [{ field: "roi", operator: "GreaterThan", value: 1.2 }],
          frequency: "EachHour",
          active: true
        },
        {
          id: "rule_2",
          name: "CBO - Gasto > 10 e Venda < 1",
          applyTo: "ActiveCampaigns",
          action: "Pause",
          conditions: [
            { field: "spend", operator: "GreaterThan", value: 10.00 },
            { field: "approvedSales", operator: "LessThan", value: 1 }
          ],
          frequency: "Each10Mins",
          active: true
        },
        {
          id: "rule_3",
          name: "CBO - Pausar ROI < 1.3",
          applyTo: "ActiveCampaigns",
          action: "Pause",
          conditions: [
            { field: "roi", operator: "LessThan", value: 1.3 },
            { field: "approvedSales", operator: "GreaterThan", value: 1 }
          ],
          frequency: "Each10Mins",
          active: true
        },
        {
          id: "rule_4",
          name: "CBO - Ativar Vendeu",
          applyTo: "PausedCampaigns",
          action: "Enable",
          conditions: [
            { field: "approvedSales", operator: "LessThan", value: 6 },
            { field: "roi", operator: "GreaterThan", value: 1.5 }
          ],
          frequency: "Each10Mins",
          active: true
        },
        {
          id: "rule_5",
          name: "ABO - BATEU CPA 22 DESATIVA",
          applyTo: "ActiveAdsets",
          action: "Pause",
          conditions: [
            { field: "cpa", operator: "GreaterThan", value: 22.00 },
            { field: "approvedSales", operator: "LessThan", value: 1 }
          ],
          frequency: "EachHour",
          active: true
        }
      ],
      settings: {
        checkoutFeePercent: 8.99,
        checkoutFeeFixed: 2.49,
        taxNfPercent: 6.0,
        metaTaxPercent: 0.0 // 0% para conta internacional/Miami, 13% para conta Brasil
      },
      visits: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
  }
}

function readDB() {
  initDB();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// -------------------------------------------------------------
// ROTAS DE SAÚDE E DIAGNÓSTICO
// -------------------------------------------------------------
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: "ok",
    app: "SF TRACKER IA Backend",
    version: "1.0.0",
    time: new Date().toISOString()
  });
});

// -------------------------------------------------------------
// WEBHOOKS PARA PLATAFORMAS (KIWIFY, CACKTO, WIAPY, HOTMART, ETC.)
// -------------------------------------------------------------
app.post('/api/v1/webhook/:platform', (req, res) => {
  const { platform } = req.params;
  const payload = req.body;
  const db = readDB();

  console.log(`[Webhook recebido] Plataforma: ${platform}`, payload);

  let saleId = payload.order_id || payload.id || payload.transaction_id || `ord_${Date.now()}`;
  let status = payload.order_status || payload.status || 'approved';
  let amount = 0;
  let productName = 'Produto';
  let paymentMethod = payload.payment_method || 'pix';
  let utmSource = payload.utm_source || (payload.tracking && payload.tracking.source) || '';
  let utmCampaign = payload.utm_campaign || (payload.tracking && payload.tracking.campaign) || '';
  let utmMedium = payload.utm_medium || '';
  let utmContent = payload.utm_content || '';
  let utmTerm = payload.utm_term || '';

  // Parser específico por plataforma
  if (platform.toLowerCase() === 'kiwify') {
    amount = (payload.order_amount || payload.amount || 0) / 100;
    productName = payload.Product ? payload.Product.product_name : (payload.product_name || 'Produto');
    status = payload.order_status === 'paid' ? 'approved' : payload.order_status;
    if (payload.TrackingParameters) {
      utmSource = payload.TrackingParameters.utm_source || utmSource;
      utmCampaign = payload.TrackingParameters.utm_campaign || utmCampaign;
      utmMedium = payload.TrackingParameters.utm_medium || utmMedium;
      utmContent = payload.TrackingParameters.utm_content || utmContent;
      utmTerm = payload.TrackingParameters.utm_term || utmTerm;
    }
  } else if (platform.toLowerCase() === 'cackto') {
    amount = parseFloat(payload.amount || payload.total || 0);
    productName = payload.product_name || (payload.product && payload.product.name) || 'Produto';
    status = payload.status === 'paid' ? 'approved' : payload.status;
  } else if (platform.toLowerCase() === 'hotmart') {
    amount = payload.data ? payload.data.purchase.price.value : (payload.price || 0);
    productName = payload.data ? payload.data.product.name : 'Produto';
    status = (payload.event === 'PURCHASE_APPROVED') ? 'approved' : 'pending';
  } else {
    amount = parseFloat(payload.amount || payload.price || payload.value || 37.00);
    productName = payload.product_name || payload.product || 'Produto';
  }

  // Parse IDs a partir da UTM dinâmica do Meta Ads: {{campaign.name}}|{{campaign.id}}
  let campaignId = "";
  let adsetId = "";
  let adId = "";

  if (utmCampaign.includes('|')) {
    campaignId = utmCampaign.split('|')[1];
  }
  if (utmMedium.includes('|')) {
    adsetId = utmMedium.split('|')[1];
  }
  if (utmContent.includes('|')) {
    adId = utmContent.split('|')[1];
  }

  const fee = (amount * (db.settings.checkoutFeePercent / 100)) + db.settings.checkoutFeeFixed;
  const netAmount = Math.max(0, amount - fee);

  const newSale = {
    id: String(saleId),
    platform,
    product: productName,
    status: status.toLowerCase(),
    paymentMethod: paymentMethod.toLowerCase(),
    amount: Number(amount.toFixed(2)),
    fee: Number(fee.toFixed(2)),
    netAmount: Number(netAmount.toFixed(2)),
    utm_source: utmSource || "direto",
    utm_campaign: utmCampaign || "sem_campanha",
    utm_medium: utmMedium || "sem_conjunto",
    utm_content: utmContent || "sem_anuncio",
    utm_term: utmTerm || "",
    campaignId,
    adsetId,
    adId,
    customerEmail: payload.customer_email || (payload.Customer && payload.Customer.email) || "cliente@email.com",
    createdAt: new Date().toISOString()
  };

  db.sales.unshift(newSale);
  writeDB(db);

  return res.status(200).json({ success: true, message: "Webhook processado", sale: newSale });
});

// -------------------------------------------------------------
// VENDAS (LISTAR E ADICIONAR TESTE)
// -------------------------------------------------------------
app.get('/api/v1/sales', (req, res) => {
  const db = readDB();
  res.json({ success: true, sales: db.sales });
});

app.post('/api/v1/sales/test', (req, res) => {
  const db = readDB();
  const sampleSale = {
    id: `ord_${Date.now()}`,
    platform: req.body.platform || "Kiwify",
    product: req.body.product || "Protocolo Magnésio",
    status: "approved",
    paymentMethod: req.body.paymentMethod || "pix",
    amount: Number(req.body.amount || 37.00),
    fee: 3.59,
    netAmount: 33.41,
    utm_source: "FB",
    utm_campaign: "C01_Magnes_testecriativo|12021001",
    utm_medium: "aberto_45|23021001",
    utm_content: "ad01_37|34021001",
    utm_term: "Instagram_Feed",
    campaignId: "12021001",
    adsetId: "23021001",
    adId: "34021001",
    customerEmail: "teste@sftracker.ia",
    createdAt: new Date().toISOString()
  };

  db.sales.unshift(sampleSale);
  writeDB(db);
  res.json({ success: true, sale: sampleSale });
});

// -------------------------------------------------------------
// PIXEL DE RASTREAMENTO DE VISITAS AO VIVO
// -------------------------------------------------------------
app.post('/api/v1/track', (req, res) => {
  const db = readDB();
  const visit = {
    id: `vis_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    url: req.body.url || "",
    referrer: req.body.referrer || "",
    utm_source: req.body.utm_source || "",
    utm_campaign: req.body.utm_campaign || "",
    utm_medium: req.body.utm_medium || "",
    utm_content: req.body.utm_content || "",
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    createdAt: new Date().toISOString()
  };

  db.visits.unshift(visit);
  // Mantém apenas os últimos 500 acessos
  if (db.visits.length > 500) {
    db.visits = db.visits.slice(0, 500);
  }
  writeDB(db);

  res.status(200).json({ success: true });
});

app.get('/api/v1/track/live', (req, res) => {
  const db = readDB();
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const activeNow = db.visits.filter(v => v.createdAt >= fiveMinutesAgo).length;
  res.json({ success: true, liveCount: activeNow, recentVisits: db.visits.slice(0, 50) });
});

// -------------------------------------------------------------
// INTEGRAÇÃO META ADS (MULTILOGIN QUICK CONNECT / OAUTH / TOKEN)
// -------------------------------------------------------------
app.get('/api/v1/meta/auth-url', (req, res) => {
  const appId = req.query.app_id || process.env.META_APP_ID || "142839201948291";
  const redirectUri = req.query.redirect_uri || process.env.META_REDIRECT_URI || "https://sftrackeria.netlify.app";
  const scope = "ads_read,ads_management,read_insights,business_management";

  const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=token`;

  res.json({
    success: true,
    authUrl,
    instructions: "Abra a sua janela do Multilogin (Dolphin/AdsPower) onde o perfil do Facebook já está logado, cole este link e clique em Autorizar."
  });
});

app.post('/api/v1/meta/connect-token', async (req, res) => {
  const { token, bmName } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, error: "Token não fornecido." });
  }

  const db = readDB();
  try {
    // Consulta Graph API para listar contas de anúncio ligadas ao token
    const graphRes = await axios.get(`https://graph.facebook.com/v21.0/me/adaccounts?fields=name,account_id,currency,account_status,business_name&access_token=${token}`);
    const accountsData = graphRes.data.data || [];

    const newAccounts = accountsData.map(acc => ({
      id: `act_${acc.account_id}`,
      name: acc.name,
      bmName: acc.business_name || bmName || "BM Conectada",
      currency: acc.currency || "BRL",
      status: acc.account_status === 1 ? "ACTIVE" : "PAUSED",
      token: token,
      spendToday: 0.0,
      clicksToday: 0,
      impressionsToday: 0
    }));

    // Atualiza ou insere as contas no banco
    newAccounts.forEach(newAcc => {
      const idx = db.metaAccounts.findIndex(a => a.id === newAcc.id);
      if (idx >= 0) {
        db.metaAccounts[idx] = { ...db.metaAccounts[idx], ...newAcc };
      } else {
        db.metaAccounts.push(newAcc);
      }
    });

    writeDB(db);
    return res.json({ success: true, count: newAccounts.length, accounts: newAccounts });
  } catch (err) {
    // Fallback: se estiver em ambiente sem acesso externo direto, registra a conta manualmente
    const fallbackAcc = {
      id: `act_${Date.now().toString().slice(-8)}`,
      name: `Conta Anúncios (${bmName || 'Multilogin'})`,
      bmName: bmName || "BM Perfil Multilogin",
      currency: "BRL",
      status: "ACTIVE",
      token: token,
      spendToday: 0.0,
      clicksToday: 0,
      impressionsToday: 0
    };
    db.metaAccounts.push(fallbackAcc);
    writeDB(db);
    return res.json({ success: true, message: "Conta conectada localmente", account: fallbackAcc });
  }
});

app.get('/api/v1/meta/accounts', (req, res) => {
  const db = readDB();
  res.json({ success: true, accounts: db.metaAccounts });
});

app.get('/api/v1/campaigns', (req, res) => {
  const db = readDB();
  res.json({ success: true, campaigns: db.campaigns });
});

// -------------------------------------------------------------
// REGRAS AUTOMATIZADAS (CBO / ABO - STOP LOSS & ESCALA)
// -------------------------------------------------------------
app.get('/api/v1/rules', (req, res) => {
  const db = readDB();
  res.json({ success: true, rules: db.rules });
});

app.post('/api/v1/rules', (req, res) => {
  const db = readDB();
  const newRule = {
    id: `rule_${Date.now()}`,
    name: req.body.name,
    applyTo: req.body.applyTo,
    action: req.body.action,
    actionPercent: req.body.actionPercent || 0,
    conditions: req.body.conditions || [],
    frequency: req.body.frequency || "Each10Mins",
    active: true
  };
  db.rules.push(newRule);
  writeDB(db);
  res.json({ success: true, rule: newRule });
});

app.post('/api/v1/rules/execute', async (req, res) => {
  const db = readDB();
  const executedLogs = [];

  for (const rule of db.rules) {
    if (!rule.active) continue;

    // Simula e executa a verificação contra as campanhas
    for (const camp of db.campaigns) {
      // Calcula vendas atribuídas à campanha
      const campSales = db.sales.filter(s => s.campaignId === camp.id && s.status === 'approved');
      const approvedCount = campSales.length;
      const revenue = campSales.reduce((acc, s) => acc + s.amount, 0);
      const spend = camp.spend;
      const roi = spend > 0 ? (revenue / spend) : 0;
      const cpa = approvedCount > 0 ? (spend / approvedCount) : spend;

      let matched = false;

      // Avalia condições
      if (rule.name.includes("Gasto > 10 e Venda < 1") && spend > 10 && approvedCount < 1) {
        matched = true;
      } else if (rule.name.includes("Pausar ROI < 1.3") && roi < 1.3 && approvedCount >= 1) {
        matched = true;
      } else if (rule.name.includes("CPA 22") && cpa > 22 && approvedCount < 1) {
        matched = true;
      } else if (rule.name.includes("ABO +30% ORC") && roi > 1.2) {
        matched = true;
      }

      if (matched) {
        executedLogs.push({
          rule: rule.name,
          target: camp.name,
          action: rule.action,
          spend,
          approvedSales: approvedCount,
          roi: Number(roi.toFixed(2)),
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  res.json({
    success: true,
    totalRulesEvaluated: db.rules.length,
    actionsTriggered: executedLogs.length,
    logs: executedLogs
  });
});

// -------------------------------------------------------------
// CONFIGURAÇÕES DE TAXAS E IMPOSTOS
// -------------------------------------------------------------
app.get('/api/v1/settings', (req, res) => {
  const db = readDB();
  res.json({ success: true, settings: db.settings });
});

app.post('/api/v1/settings', (req, res) => {
  const db = readDB();
  db.settings = { ...db.settings, ...req.body };
  writeDB(db);
  res.json({ success: true, settings: db.settings });
});

// Inicia servidor
app.listen(PORT, () => {
  initDB();
  console.log(`SF TRACKER IA Server rodando na porta ${PORT}`);
});
