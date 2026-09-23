const express = require('express');
const router = express.Router();

// Agar aapke paas already koi auth middleware hai to wo use kar sakte hain, 
// ya ye simple secret token check use karein:
const API_SECRET = process.env.GARMENT_API_SECRET || process.env.API_SECRET || 'my_secret_token_123';

function authenticateSync(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'Authorization header missing' });
  }
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (token !== API_SECRET) {
    return res.status(403).json({ success: false, message: 'Invalid API Secret' });
  }
  next();
}

// Memory ya Database store
// Note: Agar aap MongoDB/Mongoose use kar rahe hain to wahan Schema bhi bana sakte hain
let garmentSyncStore = [];

// 1. Health check for Garment Sync
// GET https://mohd-garment-server.onrender.com/api/v1/sync/health
router.get('/health', (req, res) => {
  res.json({
    status: 'Garment Sync Service Active',
    timestamp: Date.now(),
    totalRecords: garmentSyncStore.length
  });
});

// 2. PUSH: Android App se naye Bills, Payments, Designs receive karna
// POST https://mohd-garment-server.onrender.com/api/v1/sync/push
router.post('/push', authenticateSync, (req, res) => {
  try {
    const { factoryId, records } = req.body;

    if (!Array.isArray(records)) {
      return res.status(400).json({ success: false, message: 'records must be an array' });
    }

    const now = Date.now();
    let count = 0;

    for (const record of records) {
      const idx = garmentSyncStore.findIndex(r => r.id === record.id);
      const item = {
        ...record,
        factoryId: factoryId || record.factoryId,
        serverTimestamp: now
      };

      if (idx >= 0) {
        garmentSyncStore[idx] = item;
      } else {
        garmentSyncStore.push(item);
      }
      count++;
    }

    console.log(`[GarmentSync] Factory ${factoryId}: saved ${count} records at ${new Date().toISOString()}`);

    return res.json({
      success: true,
      processedCount: count,
      serverTimestamp: now,
      message: 'Sync successful'
    });
  } catch (error) {
    console.error('Garment Sync Push Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// 3. PULL: Updates mangwana
// GET https://mohd-garment-server.onrender.com/api/v1/sync/pull
router.get('/pull', authenticateSync, (req, res) => {
  try {
    const { factoryId, sinceTimestamp } = req.query;
    const since = parseInt(sinceTimestamp, 10) || 0;

    const updates = garmentSyncStore.filter(r => {
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
  } catch (error) {
    console.error('Garment Sync Pull Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;