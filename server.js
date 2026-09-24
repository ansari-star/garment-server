const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 🌐 SERVE WEB PORTAL FRONTEND
app.use(express.static(path.join(__dirname, 'public')));

const GARMENT_SECRET = process.env.API_SECRET_TOKEN || process.env.API_SECRET || "my_secret_token_123";
let garmentSyncDatabase = [];

// ==========================================
// 👕 1. ANDROID & WEB REAL-TIME DATA ENDPOINTS
// ==========================================

// Web Portal ke liye data mangwana
app.get("/api/v1/web/data", (req, res) => {
  const bills = [];
  const payments = [];
  const designs = [];
  let factory = { name: "Garment Factory", openingBalance: 0, balanceType: "RECEIVABLE" };

  for (const record of garmentSyncDatabase) {
    try {
      const payload = typeof record.payloadJson === 'string' ? JSON.parse(record.payloadJson) : record.payloadJson;
      if (record.entityType === 'BILL') bills.push(payload);
      if (record.entityType === 'PAYMENT') payments.push(payload);
      if (record.entityType === 'DESIGN') designs.push(payload);
      if (record.entityType === 'FACTORY') factory = payload;
    } catch (e) {}
  }

  res.json({ factory, bills, payments, designs });
});

// Web Portal se naya Bill add karna
app.post("/api/v1/web/bills", (req, res) => {
  const bill = req.body;
  const now = Date.now();
  const id = "bill_" + now;

  garmentSyncDatabase.push({
    id: id,
    entityType: "BILL",
    entityId: id,
    operation: "CREATE",
    payloadJson: JSON.stringify(bill),
    version: 1,
    timestamp: now,
    serverTimestamp: now
  });

  res.json({ success: true, billId: id });
});

// Web Portal se naya Payment add karna
app.post("/api/v1/web/payments", (req, res) => {
  const pay = req.body;
  const now = Date.now();
  const id = "pay_" + now;

  garmentSyncDatabase.push({
    id: id,
    entityType: "PAYMENT",
    entityId: id,
    operation: "CREATE",
    payloadJson: JSON.stringify(pay),
    version: 1,
    timestamp: now,
    serverTimestamp: now
  });

  res.json({ success: true, paymentId: id });
});

// 2. Health check route
app.get("/api/v1/sync/health", (req, res) => {
  res.json({ status: "Garment Sync Service Active", time: new Date().toISOString(), totalRecords: garmentSyncDatabase.length });
});

// 3. Android App Push route
app.post("/api/v1/sync/push", (req, res) => {
  try {
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (token !== GARMENT_SECRET) {
      return res.status(403).json({ success: false, message: "Invalid API Secret" });
    }

    const { factoryId, records } = req.body;
    if (!Array.isArray(records)) {
      return res.status(400).json({ success: false, message: "records must be an array" });
    }

    const now = Date.now();
    let count = 0;
    for (const record of records) {
      const idx = garmentSyncDatabase.findIndex(r => r.id === record.id);
      const item = { ...record, factoryId: factoryId || record.factoryId, serverTimestamp: now };
      if (idx >= 0) {
        garmentSyncDatabase[idx] = item;
      } else {
        garmentSyncDatabase.push(item);
      }
      count++;
    }

    return res.json({ success: true, processedCount: count, serverTimestamp: now, message: "Sync push success" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 4. Android App Pull route
app.get("/api/v1/sync/pull", (req, res) => {
  try {
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (token !== GARMENT_SECRET) {
      return res.status(403).json({ success: false, message: "Invalid API Secret" });
    }

    const { factoryId, sinceTimestamp } = req.query;
    const since = parseInt(sinceTimestamp, 10) || 0;

    const updates = garmentSyncDatabase.filter(r => {
      const matchFactory = !factoryId || r.factoryId === factoryId;
      const matchTime = (r.serverTimestamp || r.timestamp) > since;
      return matchFactory && matchTime;
    });

    return res.json({ success: true, count: updates.length, serverTimestamp: Date.now(), records: updates });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 🌐 Root & /web Route to open Web Portal in Browser
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/web', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ==========================================
// 🗄️ EXISTING POSTGRES DATABASE & ROUTES
// ==========================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS masters (id VARCHAR(100) PRIMARY KEY, factory_id VARCHAR(100) NOT NULL, name VARCHAR(255) NOT NULL, mobile VARCHAR(50), address TEXT, opening_balance NUMERIC(12,2) DEFAULT 0, active BOOLEAN DEFAULT TRUE, updated_at BIGINT);
    CREATE TABLE IF NOT EXISTS maal_bills (id VARCHAR(100) PRIMARY KEY, factory_id VARCHAR(100) NOT NULL, bill_no VARCHAR(100) NOT NULL, date VARCHAR(20), master_id VARCHAR(100), master_name VARCHAR(255), discount_percent NUMERIC(5,2) DEFAULT 0, sub_total NUMERIC(12,2) DEFAULT 0, discount_amount NUMERIC(12,2) DEFAULT 0, total_amount NUMERIC(12,2) DEFAULT 0, notes TEXT, updated_at BIGINT);
    CREATE TABLE IF NOT EXISTS fabric_challans (id VARCHAR(100) PRIMARY KEY, factory_id VARCHAR(100) NOT NULL, challan_no VARCHAR(100) NOT NULL, date VARCHAR(20), master_id VARCHAR(100), master_name VARCHAR(255), total_amount NUMERIC(12,2) DEFAULT 0, notes TEXT, updated_at BIGINT);
    CREATE TABLE IF NOT EXISTS payments (id VARCHAR(100) PRIMARY KEY, factory_id VARCHAR(100) NOT NULL, payment_no VARCHAR(100) NOT NULL, date VARCHAR(20), master_id VARCHAR(100), master_name VARCHAR(255), amount NUMERIC(12,2) DEFAULT 0, mode VARCHAR(50) DEFAULT 'Cash', notes TEXT, updated_at BIGINT);
  `);
}
initDb().catch(console.error);

app.get('/api/v1/health', (req, res) => res.json({ status: 'ONLINE', message: 'Central Server Running!' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));