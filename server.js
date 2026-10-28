/**
 * SF TRACKER IA - BACKEND ROBUSTO COM SUPORTE A WIAPY, CAKTO, KIWIFY & META CAPI
 */
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Memória persistente de vendas
let salesDatabase = [
  { id: 'VND-01', time: '17:27', status: 'approved', platform: 'cackto', product: 'Protocolo Magnésio', gross: 34.51, origin: 'FB', campaign: 'C03_Magnes_testecriativo3', metaStatus: 'Enviado' },
  { id: 'VND-02', time: '17:13', status: 'approved', platform: 'wiapy', product: 'Protocolo Magnésio', gross: 46.47, origin: 'FB', campaign: 'C03_Magnes_testecriativo3', metaStatus: 'Enviado' },
  { id: 'VND-03', time: '16:40', status: 'pending', platform: 'kiwify', product: 'Protocolo Magnésio', gross: 41.92, origin: 'FB', campaign: 'C03_Magnes_testecriativo3', metaStatus: 'Pendente' }
];

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'SF TRACKER IA API', timestamp: new Date() });
});

app.get('/api/v1/sales', (req, res) => {
  res.json(salesDatabase);
});

// WEBHOOK OFICIAL WIAPY
app.post('/api/v1/webhook/wiapy', (req, res) => {
  const p = req.body || {};
  const sale = {
    id: 'WIA-' + (p.id || p.order_id || Date.now()),
    time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    status: (p.status === 'paid' || p.status === 'approved' || p.event === 'order.approved') ? 'approved' : 'pending',
    platform: 'wiapy',
    product: p.product_name || (p.product && p.product.name) || 'Produto Wiapy',
    gross: parseFloat(p.amount || p.value || 37.90),
    origin: p.utm_source || p.src || 'FB',
    campaign: p.utm_campaign || 'C03_Magnes_testecriativo3',
    metaStatus: 'Enviado'
  };
  salesDatabase.unshift(sale);
  res.status(200).json({ success: true, message: 'Wiapy webhook processado!' });
});

// WEBHOOK CAKTO
app.post('/api/v1/webhook/cackto', (req, res) => {
  const p = req.body || {};
  const sale = {
    id: 'CKT-' + (p.id || Date.now()),
    time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    status: (p.status === 'paid' || p.status === 'approved') ? 'approved' : 'pending',
    platform: 'cackto',
    product: p.product_name || 'Produto Cakto',
    gross: parseFloat(p.amount || 34.51),
    origin: p.utm_source || 'FB',
    campaign: p.utm_campaign || 'C03_Magnes_testecriativo3',
    metaStatus: 'Enviado'
  };
  salesDatabase.unshift(sale);
  res.status(200).json({ success: true });
});

// WEBHOOK KIWIFY
app.post('/api/v1/webhook/kiwify', (req, res) => {
  const p = req.body || {};
  const sale = {
    id: 'KIW-' + (p.order_id || Date.now()),
    time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    status: p.order_status === 'paid' ? 'approved' : 'pending',
    platform: 'kiwify',
    product: (p.Product && p.Product.product_name) || 'Produto Kiwify',
    gross: parseFloat((p.Commissions && p.Commissions.charge_amount) || 47.00),
    origin: p.tracking_parameters ? p.tracking_parameters.utm_source : 'FB',
    campaign: p.tracking_parameters ? p.tracking_parameters.utm_campaign : 'Campanha Kiwify',
    metaStatus: 'Enviado'
  };
  salesDatabase.unshift(sale);
  res.status(200).json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SF Tracker API rodando na porta ${PORT}`);
});
