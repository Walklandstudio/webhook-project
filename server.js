require('dotenv').config(); // ✅ Load environment variables from .env

const express = require('express');
const fs = require('fs');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// ✅ Confirm environment variables are loaded
console.log("🔍 Loaded ENV keys:", {
  ACCOUNT_A_API: process.env.ACCOUNT_A_API,
  ACCOUNT_B_API: process.env.ACCOUNT_B_API,
  ACCOUNT_C_API: process.env.ACCOUNT_C_API
});

// 🔧 Helper: log webhook payloads to files
function logToFile(filename, data) {
  const entry = {
    timestamp: new Date().toISOString(),
    payload: data
  };
  fs.appendFile(filename, JSON.stringify(entry) + '\n', (err) => {
    if (err) {
      console.error(`❌ Error writing to ${filename}:`, err);
    } else {
      console.log(`✅ Logged to ${filename}`);
    }
  });
}

// ====================
// 🔗 Webhook 1 (Account A)
// ====================
app.post('/webhook', async (req, res) => {
  const apiKey = process.env.ACCOUNT_A_API;
  const payload = req.body;

  console.log('📩 Account A Webhook:', payload);
  logToFile('accountA-log.json', payload);

  try {
    const response = await axios.post('https://rest.gohighlevel.com/v1/contacts/', payload, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ Sent to Account A GHL:', response.data);
    res.status(200).send('Sent to Account A');
  } catch (err) {
    console.error('❌ Error sending to Account A GHL:', err.response?.data || err.message);
    res.status(500).send('Error sending to Account A');
  }
});

// ====================
// 🔗 Webhook 2 (Account B)
// ====================
app.post('/webhook2', async (req, res) => {
  const apiKey = process.env.ACCOUNT_B_API;
  const payload = req.body;

  console.log('📩 Account B Webhook:', payload);
  logToFile('accountB-log.json', payload);

  try {
    const response = await axios.post('https://rest.gohighlevel.com/v1/contacts/', payload, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ Sent to Account B GHL:', response.data);
    res.status(200).send('Sent to Account B');
  } catch (err) {
    console.error('❌ Error sending to Account B GHL:', err.response?.data || err.message);
    res.status(500).send('Error sending to Account B');
  }
});

// ====================
// 🔗 Webhook 3 (Account C)
// ====================
app.post('/webhook3', async (req, res) => {
  const apiKey = process.env.ACCOUNT_C_API;
  const payload = req.body;

  console.log('📩 Account C Webhook:', payload);
  logToFile('accountC-log.json', payload);

  try {
    const response = await axios.post('https://rest.gohighlevel.com/v1/contacts/', payload, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✅ Sent to Account C GHL:', response.data);
    res.status(200).send('Sent to Account C');
  } catch (err) {
    console.error('❌ Error sending to Account C GHL:', err.response?.data || err.message);
    res.status(500).send('Error sending to Account C');
  }
});

// 🔍 Debug route to check env loading
app.get('/env-test', (req, res) => {
  res.json({
    accountA: process.env.ACCOUNT_A_API ? '✅ Loaded' : '❌ Missing',
    accountB: process.env.ACCOUNT_B_API ? '✅ Loaded' : '❌ Missing',
    accountC: process.env.ACCOUNT_C_API ? '✅ Loaded' : '❌ Missing',
  });
});

// 🚀 Start the server
app.listen(port, () => {
  console.log(`🚀 Webhook server running at http://localhost:${port}`);
});


