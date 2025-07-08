require('dotenv').config(); // ✅ Load .env into process.env

const express = require('express');
const fs      = require('fs');
const axios   = require('axios');
const app     = express();
const port    = process.env.PORT || 3000;

app.use(express.json());

// Confirm ENV loading
console.log("🔍 Loaded ENV keys:", {
  ACCOUNT_A_API: !!process.env.ACCOUNT_A_API,
  ACCOUNT_B_API: !!process.env.ACCOUNT_B_API,
  ACCOUNT_C_API: !!process.env.ACCOUNT_C_API
});

// Helper: append a timestamped JSON entry to a file
function logToFile(filename, data) {
  const entry = { timestamp: new Date().toISOString(), payload: data };
  fs.appendFile(filename, JSON.stringify(entry) + '\n', err => {
    if (err) console.error(`❌ Error writing to ${filename}:`, err);
    else     console.log(`✅ Logged to ${filename}`);
  });
}

// ── WEBHOOK 1 (Account A) ───────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const payload = req.body;
  console.log('📩 Account A Webhook:', payload);
  logToFile('accountA-log.json', payload);

  // Build only the fields GHL needs:
  const contact = {
    email:     payload.email   || payload.contact?.email,
    phone:     payload.phone   || payload.contact?.phone,
    firstName: payload.firstName || payload.contact?.first_name,
    lastName:  payload.lastName  || payload.contact?.last_name,
    tags:      payload.tags    || payload.contact?.tags || []
  };

  // Skip if missing both required fields
  if (!contact.email && !contact.phone) {
    console.log('⚠️ Skipping Account A: missing both email and phone');
    return res.status(400).send('Missing email or phone');
  }

  try {
    const resp = await axios.post(
      'https://rest.gohighlevel.com/v1/contacts/',
      contact,
      {
        headers: {
          Authorization: `Bearer ${process.env.ACCOUNT_A_API}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('✅ Sent to Account A GHL, contact id:', resp.data.id || resp.data);
    res.status(200).send('Sent to Account A');
  } catch (err) {
    console.error('❌ Error sending to Account A GHL:', err.response?.data || err.message);
    res.status(500).send('Error sending to Account A');
  }
});

// ── WEBHOOK 2 (Account B) ───────────────────────────────────────
app.post('/webhook2', async (req, res) => {
  const payload = req.body;
  console.log('📩 Account B Webhook:', payload);
  logToFile('accountB-log.json', payload);

  const contact = {
    email:     payload.email   || payload.contact?.email,
    phone:     payload.phone   || payload.contact?.phone,
    firstName: payload.firstName || payload.contact?.first_name,
    lastName:  payload.lastName  || payload.contact?.last_name,
    tags:      payload.tags    || payload.contact?.tags || []
  };

  if (!contact.email && !contact.phone) {
    console.log('⚠️ Skipping Account B: missing both email and phone');
    return res.status(400).send('Missing email or phone');
  }

  try {
    const resp = await axios.post(
      'https://rest.gohighlevel.com/v1/contacts/',
      contact,
      {
        headers: {
          Authorization: `Bearer ${process.env.ACCOUNT_B_API}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('✅ Sent to Account B GHL, contact id:', resp.data.id || resp.data);
    res.status(200).send('Sent to Account B');
  } catch (err) {
    console.error('❌ Error sending to Account B GHL:', err.response?.data || err.message);
    res.status(500).send('Error sending to Account B');
  }
});

// ── WEBHOOK 3 (Account C) ───────────────────────────────────────
app.post('/webhook3', async (req, res) => {
  const payload = req.body;
  console.log('📩 Account C Webhook:', payload);
  logToFile('accountC-log.json', payload);

  const contact = {
    email:     payload.email   || payload.contact?.email,
    phone:     payload.phone   || payload.contact?.phone,
    firstName: payload.firstName || payload.contact?.first_name,
    lastName:  payload.lastName  || payload.contact?.last_name,
    tags:      payload.tags    || payload.contact?.tags || []
  };

  if (!contact.email && !contact.phone) {
    console.log('⚠️ Skipping Account C: missing both email and phone');
    return res.status(400).send('Missing email or phone');
  }

  try {
    const resp = await axios.post(
      'https://rest.gohighlevel.com/v1/contacts/',
      contact,
      {
        headers: {
          Authorization: `Bearer ${process.env.ACCOUNT_C_API}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('✅ Sent to Account C GHL, contact id:', resp.data.id || resp.data);
    res.status(200).send('Sent to Account C');
  } catch (err) {
    console.error('❌ Error sending to Account C GHL:', err.response?.data || err.message);
    res.status(500).send('Error sending to Account C');
  }
});

// 🔍 ENV-TEST (debug): verify keys loaded
app.get('/env-test', (req, res) => {
  res.json({
    accountA: process.env.ACCOUNT_A_API ? '✅ Loaded' : '❌ Missing',
    accountB: process.env.ACCOUNT_B_API ? '✅ Loaded' : '❌ Missing',
    accountC: process.env.ACCOUNT_C_API ? '✅ Loaded' : '❌ Missing'
  });
});

// 🚀 Health-check
app.get('/', (req, res) => {
  res.send('✅ Webhook server running.');
});
// ── WEBHOOK 4 (GHL to HubSpot) ───────────────────────────────
app.post('/webhook/ghl-to-hubspot', async (req, res) => {
  try {
    const {
      email,
      firstName,
      lastName,
      phone,
      source,
      tags,
      my_custom_field // add as many custom fields as you want!
    } = req.body;

    if (!email) {
      return res.status(400).json({ status: 'error', message: 'Missing required field: email' });
    }

    const hubspotData = {
      properties: {
        email,
        firstname: firstName || '',
        lastname: lastName || '',
        phone: phone || '',
        source: source || '',
        tags: tags || '',
        my_custom_field: my_custom_field || ''
        // Add more custom properties if needed
      }
    };

    const hubspotResponse = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/contacts',
      hubspotData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`
        }
      }
    );

    console.log('✅ Contact sent to HubSpot:', hubspotResponse.data);

    res.status(200).json({ status: 'success', data: hubspotResponse.data });
  } catch (error) {
    console.error('❌ HubSpot Error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      error: error.response?.data || error.message
    });
  }
});

app.listen(port, () => {
  console.log(`🚀 Webhook server listening on port ${port}`);
});
