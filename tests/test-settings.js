// Test script to verify settings system
const express = require('express');
const path = require('path');
const { db } = require('./server/sqlite');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Test settings endpoints
app.get('/api/settings', (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM settings');
    const settings = stmt.all();
    res.json(settings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const { key, value } = req.body;
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(key, value);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving setting:', error);
    res.status(500).json({ error: 'Failed to save setting' });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ Test server running on http://localhost:${PORT}`);
  console.log('📊 Settings system ready!');
  
  // Test database connection
  try {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM settings');
    const result = stmt.get();
    console.log(`📋 Settings in database: ${result.count}`);
  } catch (error) {
    console.error('❌ Database error:', error);
  }
});