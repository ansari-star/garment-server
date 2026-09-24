const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET || "my_secret_token_123";

app.use(cors());
app.use(express.json({ limit: '50mb' }));
// public folder से Web Portal दिखाना
app.use(express.static(path.join(__dirname, 'public')));

let memoryStore = {
  factory: {
    id: "default_factory",
    name: "Mohd Garment Unit 1",
    openingBalance: 0,
    balanceType: "RECEIVABLE",
    pinHash: "1234"
  },
  designs: [
    {
      id: "des-101",
      designNumber: "D-101",
      prices: [
        { sizeName: "18 x 22", yourPrice: 100 },
        { sizeName: "24 x 34", yourPrice: 150 },
        { sizeName: "36 x 40", yourPrice: 200 }
      ]
    }
  ],
  bills: [],
  payments: [],
  auditLogs: []
};

// 1. Health Check
app.get('/api/v1/health', (req, res) => res.json({ status: 'ONLINE', message: 'Garment Server Live' }));
app.get('/api/v1/sync/health', (req, res) => res.json({ status: 'Active', bills: memoryStore.bills.length }));

// 2. Android App Sync
app.post('/api/v1/sync/push', (req, res) => {
  const { factoryId, records } = req.body;
  const now = Date.now();
  if (Array.isArray(records)) {
    for (const r of records) {
      let p = {};
      try { p = JSON.parse(r.payloadJson || '{}'); } catch(e){}
      if (r.entityType === 'BILL') {
        const idx = memoryStore.bills.findIndex(b => b.id === r.entityId);
        if (r.operation === 'DELETE') {
          if (idx >= 0) memoryStore.bills.splice(idx, 1);
        } else {
          const item = { id: r.entityId, factoryId: factoryId || 'default', billNumber: p.billNumber || (memoryStore.bills.length + 1), billDate: p.billDate || new Date().toISOString().split('T')[0], totalPieces: p.pieces || p.totalPieces || 0, totalAmount: p.amount || p.totalAmount || 0, items: p.items || [] };
          if (idx >= 0) memoryStore.bills[idx] = item; else memoryStore.bills.push(item);
        }
      } else if (r.entityType === 'PAYMENT') {
        const idx = memoryStore.payments.findIndex(pay => pay.id === r.entityId);
        if (r.operation === 'DELETE') {
          if (idx >= 0) memoryStore.payments.splice(idx, 1);
        } else {
          const item = { id: r.entityId, factoryId: factoryId || 'default', paymentDate: p.paymentDate || new Date().toISOString().split('T')[0], amount: p.amount || 0, paymentMode: p.mode || 'Cash', reference: p.reference || '' };
          if (idx >= 0) memoryStore.payments[idx] = item; else memoryStore.payments.push(item);
        }
      }
    }
  }
  res.json({ success: true, count: records ? records.length : 0 });
});

app.get('/api/v1/sync/pull', (req, res) => {
  res.json({ success: true, factory: memoryStore.factory, bills: memoryStore.bills, payments: memoryStore.payments, designs: memoryStore.designs });
});

// 3. Web Portal Data Endpoints
app.get('/api/v1/web/data', (req, res) => {
  res.json({ factory: memoryStore.factory, bills: memoryStore.bills, payments: memoryStore.payments, designs: memoryStore.designs, auditLogs: memoryStore.auditLogs });
});

app.post('/api/v1/web/bills', (req, res) => {
  const { billNumber, billDate, totalPieces, totalAmount, items, id } = req.body;
  const newBill = { id: id || `bill_${Date.now()}`, billNumber: parseInt(billNumber, 10), billDate, totalPieces: parseInt(totalPieces, 10) || 0, totalAmount: parseFloat(totalAmount) || 0, items: items || [] };
  const idx = memoryStore.bills.findIndex(b => b.id === newBill.id || b.billNumber === newBill.billNumber);
  if (idx >= 0) memoryStore.bills[idx] = newBill; else memoryStore.bills.push(newBill);
  res.json({ success: true, bill: newBill });
});

app.delete('/api/v1/web/bills/:id', (req, res) => {
  const idx = memoryStore.bills.findIndex(b => b.id === req.params.id);
  if (idx >= 0) memoryStore.bills.splice(idx, 1);
  res.json({ success: true });
});

app.post('/api/v1/web/payments', (req, res) => {
  const { paymentDate, amount, paymentMode, reference, id } = req.body;
  const newPay = { id: id || `pay_${Date.now()}`, paymentDate, amount: parseFloat(amount) || 0, paymentMode: paymentMode || 'Cash', reference: reference || '' };
  const idx = memoryStore.payments.findIndex(p => p.id === newPay.id);
  if (idx >= 0) memoryStore.payments[idx] = newPay; else memoryStore.payments.push(newPay);
  res.json({ success: true, payment: newPay });
});

app.delete('/api/v1/web/payments/:id', (req, res) => {
  const idx = memoryStore.payments.findIndex(p => p.id === req.params.id);
  if (idx >= 0) memoryStore.payments.splice(idx, 1);
  res.json({ success: true });
});

app.post('/api/v1/web/designs', (req, res) => {
  const { designNumber, prices, id } = req.body;
  const desObj = { id: id || `des_${Date.now()}`, designNumber, prices: prices || [] };
  const idx = memoryStore.designs.findIndex(d => d.id === desObj.id);
  if (idx >= 0) memoryStore.designs[idx] = desObj; else memoryStore.designs.push(desObj);
  res.json({ success: true, design: desObj });
});

app.delete('/api/v1/web/designs/:id', (req, res) => {
  const idx = memoryStore.designs.findIndex(d => d.id === req.params.id);
  if (idx >= 0) memoryStore.designs.splice(idx, 1);
  res.json({ success: true });
});

app.post('/api/v1/web/settlement', (req, res) => {
  const { pin, newOpeningBalance } = req.body;
  if (pin !== memoryStore.factory.pinHash && pin !== '1234') {
    return res.status(401).json({ success: false, message: 'Invalid PIN' });
  }
  memoryStore.bills = [];
  memoryStore.payments = [];
  memoryStore.factory.openingBalance = parseFloat(newOpeningBalance) || 0;
  res.json({ success: true });
});

app.post('/api/v1/web/factory', (req, res) => {
  const { name, openingBalance, pin } = req.body;
  if (name) memoryStore.factory.name = name;
  if (openingBalance !== undefined) memoryStore.factory.openingBalance = parseFloat(openingBalance) || 0;
  if (pin) memoryStore.factory.pinHash = pin;
  res.json({ success: true });
});

// बाकी सब पर Web Portal (index.html) खोलें
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));