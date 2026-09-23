const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Secret Token support (dono env variables check karega)
const GARMENT_SECRET = process.env.API_SECRET_TOKEN || process.env.API_SECRET || "my_secret_token_123";
let garmentSyncDatabase = [];

// ==========================================
// 👕 MOHD GARMENT SYNC ROUTES
// ==========================================

// 1. Health check route (Browser me test karne ke liye)
app.get("/api/v1/sync/health", (req, res) => {
  res.json({
    status: "Garment Sync Service Active",
    time: new Date().toISOString(),
    totalRecords: garmentSyncDatabase.length
  });
});

// 2. Android App Push route
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

    return res.json({
      success: true,
      processedCount: count,
      serverTimestamp: now,
      message: "Sync push success"
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 3. Android App Pull route
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

    return res.json({
      success: true,
      count: updates.length,
      serverTimestamp: Date.now(),
      records: updates
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 🗄️ EXISTING POSTGRES DATABASE & ROUTES
// ==========================================

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Automatic Tables Creation
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS masters (
      id VARCHAR(100) PRIMARY KEY,
      factory_id VARCHAR(100) NOT NULL,
      name VARCHAR(255) NOT NULL,
      mobile VARCHAR(50),
      address TEXT,
      opening_balance NUMERIC(12,2) DEFAULT 0,
      active BOOLEAN DEFAULT TRUE,
      updated_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS maal_bills (
      id VARCHAR(100) PRIMARY KEY,
      factory_id VARCHAR(100) NOT NULL,
      bill_no VARCHAR(100) NOT NULL,
      date VARCHAR(20),
      master_id VARCHAR(100),
      master_name VARCHAR(255),
      discount_percent NUMERIC(5,2) DEFAULT 0,
      sub_total NUMERIC(12,2) DEFAULT 0,
      discount_amount NUMERIC(12,2) DEFAULT 0,
      total_amount NUMERIC(12,2) DEFAULT 0,
      notes TEXT,
      updated_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS fabric_challans (
      id VARCHAR(100) PRIMARY KEY,
      factory_id VARCHAR(100) NOT NULL,
      challan_no VARCHAR(100) NOT NULL,
      date VARCHAR(20),
      master_id VARCHAR(100),
      master_name VARCHAR(255),
      total_amount NUMERIC(12,2) DEFAULT 0,
      notes TEXT,
      updated_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS payments (
      id VARCHAR(100) PRIMARY KEY,
      factory_id VARCHAR(100) NOT NULL,
      payment_no VARCHAR(100) NOT NULL,
      date VARCHAR(20),
      master_id VARCHAR(100),
      master_name VARCHAR(255),
      amount NUMERIC(12,2) DEFAULT 0,
      mode VARCHAR(50) DEFAULT 'Cash',
      notes TEXT,
      updated_at BIGINT
    );
  `);
  console.log("Central Database Connected & Tables Ready!");
}
initDb().catch(console.error);

// 1. Live Health Check (Existing)
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ONLINE', message: 'Central Server Running!' });
});

// 2. Existing Push & Pull Endpoint
app.post('/api/v1/sync/push-pull', async (req, res) => {
  const client = await pool.connect();
  try {
    const { factoryId, deviceId, data } = req.body;
    const authHeader = req.headers['authorization'] || '';

    // Secret Token Verification (Optional Security)
    if (process.env.API_SECRET_TOKEN && process.env.API_SECRET_TOKEN.trim() !== '') {
      const expected = `Bearer ${process.env.API_SECRET_TOKEN.trim()}`;
      if (authHeader !== expected) {
        return res.status(401).json({ error: 'Invalid API Secret Token' });
      }
    }

    if (!factoryId || !data) {
      return res.status(400).json({ error: 'Missing factoryId or data' });
    }

    await client.query('BEGIN');

    // Save/Update Masters
    if (data.masters && Array.isArray(data.masters)) {
      for (const m of data.masters) {
        await client.query(`
          INSERT INTO masters (id, factory_id, name, mobile, address, opening_balance, active, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, mobile = EXCLUDED.mobile, address = EXCLUDED.address,
            opening_balance = EXCLUDED.opening_balance, active = EXCLUDED.active, updated_at = EXCLUDED.updated_at
        `, [m.id, factoryId, m.name, m.mobile || '', m.address || '', m.openingBalance || 0, m.active ?? true, Date.now()]);
      }
    }

    // Save/Update Maal Bills
    if (data.maal_bills && Array.isArray(data.maal_bills)) {
      for (const b of data.maal_bills) {
        await client.query(`
          INSERT INTO maal_bills (id, factory_id, bill_no, date, master_id, master_name, discount_percent, sub_total, discount_amount, total_amount, notes, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (id) DO UPDATE SET
            bill_no = EXCLUDED.bill_no, date = EXCLUDED.date, total_amount = EXCLUDED.total_amount, notes = EXCLUDED.notes, updated_at = EXCLUDED.updated_at
        `, [b.id, factoryId, b.billNo, b.date, b.masterId, b.masterName, b.discountPercent || 0, b.subTotal || 0, b.discountAmount || 0, b.totalAmount || 0, b.notes || '', Date.now()]);
      }
    }

    // Save/Update Fabric Challans
    if (data.fabric_challans && Array.isArray(data.fabric_challans)) {
      for (const c of data.fabric_challans) {
        await client.query(`
          INSERT INTO fabric_challans (id, factory_id, challan_no, date, master_id, master_name, total_amount, notes, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id) DO UPDATE SET
            challan_no = EXCLUDED.challan_no, date = EXCLUDED.date, total_amount = EXCLUDED.total_amount, notes = EXCLUDED.notes, updated_at = EXCLUDED.updated_at
        `, [c.id, factoryId, c.challanNo, c.date, c.masterId, c.masterName, c.totalAmount || 0, c.notes || '', Date.now()]);
      }
    }

    // Save/Update Payments
    if (data.payments && Array.isArray(data.payments)) {
      for (const p of data.payments) {
        await client.query(`
          INSERT INTO payments (id, factory_id, payment_no, date, master_id, master_name, amount, mode, notes, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (id) DO UPDATE SET
            payment_no = EXCLUDED.payment_no, date = EXCLUDED.date, amount = EXCLUDED.amount, mode = EXCLUDED.mode, notes = EXCLUDED.notes, updated_at = EXCLUDED.updated_at
        `, [p.id, factoryId, p.paymentNo, p.date, p.masterId, p.masterName, p.amount || 0, p.mode || 'Cash', p.notes || '', Date.now()]);
      }
    }

    await client.query('COMMIT');

    // Return all latest data to phone
    const mastersRes = await pool.query(`SELECT * FROM masters WHERE factory_id = $1`, [factoryId]);
    const billsRes = await pool.query(`SELECT * FROM maal_bills WHERE factory_id = $1`, [factoryId]);
    const challansRes = await pool.query(`SELECT * FROM fabric_challans WHERE factory_id = $1`, [factoryId]);
    const paymentsRes = await pool.query(`SELECT * FROM payments WHERE factory_id = $1`, [factoryId]);

    res.json({
      status: 'SUCCESS',
      serverTime: Date.now(),
      data: {
        masters: mastersRes.rows.map(r => ({ id: r.id, name: r.name, mobile: r.mobile, address: r.address, openingBalance: parseFloat(r.opening_balance), active: r.active })),
        maal_bills: billsRes.rows.map(r => ({ id: r.id, billNo: r.bill_no, date: r.date, masterId: r.master_id, masterName: r.master_name, discountPercent: parseFloat(r.discount_percent), subTotal: parseFloat(r.sub_total), discountAmount: parseFloat(r.discount_amount), totalAmount: parseFloat(r.total_amount), notes: r.notes })),
        fabric_challans: challansRes.rows.map(r => ({ id: r.id, challanNo: r.challan_no, date: r.date, masterId: r.master_id, masterName: r.master_name, totalAmount: parseFloat(r.total_amount), notes: r.notes })),
        payments: paymentsRes.rows.map(r => ({ id: r.id, paymentNo: r.payment_no, date: r.date, masterId: r.master_id, masterName: r.master_name, amount: parseFloat(r.amount), mode: r.mode, notes: r.notes }))
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Sync Error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Reset Factory Endpoint
app.post('/api/v1/sync/reset-factory', async (req, res) => {
  const { factoryId, ownerPassword } = req.body;
  const authHeader = req.headers['authorization'] || '';

  if (process.env.API_SECRET_TOKEN) {
    if (authHeader !== `Bearer ${process.env.API_SECRET_TOKEN.trim()}`) {
      return res.status(401).json({ error: 'Unauthorized Token' });
    }
  }

  try {
    await pool.query('DELETE FROM payments WHERE factory_id = $1', [factoryId]);
    await pool.query('DELETE FROM fabric_challans WHERE factory_id = $1', [factoryId]);
    await pool.query('DELETE FROM maal_bills WHERE factory_id = $1', [factoryId]);
    
    res.json({ status: 'SUCCESS', message: 'Central Server Factory Data Reset Successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Server Listen (Always at the bottom)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));