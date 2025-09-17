// server.js
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

/* ------------------------- Utilities ------------------------- */
function logToFile(filename, data) {
  const entry = { timestamp: new Date().toISOString(), payload: data };
  fs.appendFile(filename, JSON.stringify(entry) + '\n', err => {
    if (err) console.error(`❌ Error writing to ${filename}:`, err);
    else console.log(`✅ Logged to ${filename}`);
  });
}

// Normalize incoming payload into HubSpot contact properties (EXCLUDING tags + tags_completed_*)
function normalizeHubSpotContact(raw = {}) {
  const email     = raw.email;
  const firstname = raw.firstname ?? raw.firstName ?? '';
  const lastname  = raw.lastname  ?? raw.lastName  ?? '';
  const phone     = raw.phone ?? '';
  const source    = raw.source ?? '';

  return {
    // HubSpot built-ins
    email,
    firstname,
    lastname,
    phone,
    source,

    // Your custom properties that already exist in HubSpot
    investor_archetype_ppt_frequency:      raw.investor_archetype_ppt_frequency ?? '',
    investor_archetype_ppt_profile:        raw.investor_archetype_ppt_profile ?? '',
    investor_archetype_free_ppt_frequency: raw.investor_archetype_free_ppt_frequency ?? ''
    // NOTE: intentionally excluding "tags", "tags_completed_full", "tags_completed_free"
  };
}

console.log("🔍 Loaded ENV keys:", {
  ACCOUNT_A_API: !!process.env.ACCOUNT_A_API,
  ACCOUNT_B_API: !!process.env.ACCOUNT_B_API,
  ACCOUNT_C_API: !!process.env.ACCOUNT_C_API,
  HUBSPOT_ACCESS_TOKEN: !!process.env.HUBSPOT_ACCESS_TOKEN
});

/* ---------------------- Account A/B/C → GHL ---------------------- */
function buildGhlContact(payload) {
  return {
    email:     payload.email   || payload.contact?.email,
    phone:     payload.phone   || payload.contact?.phone,
    firstName: payload.firstName || payload.firstname || payload.contact?.first_name || payload.contact?.firstname,
    lastName:  payload.lastName  || payload.lastname  || payload.contact?.last_name  || payload.contact?.lastname,
    // tags can be array or comma-separated string
    tags: Array.isArray(payload.tags)
      ? payload.tags
      : (payload.tags ? String(payload.tags).split(',').map(t => t.trim()).filter(Boolean) : [])
  };
}

async function upsertToGhl(apiKey, contact) {
  return axios.post('https://rest.gohighlevel.com/v1/contacts/', contact, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
      // If your account requires it, also add: 'Version': '2021-07-28'
    },
    timeout: 15000
  });
}

app.post('/webhook', async (req, res) => {
  const payload = req.body;
  console.log('📩 Account A Webhook:', payload);
  logToFile('accountA-log.json', payload);

  const contact = buildGhlContact(payload);
  if (!contact.email && !contact.phone) {
    console.log('⚠️ Skipping Account A: missing both email and phone');
    return res.status(400).send('Missing email or phone');
  }

  try {
    const resp = await upsertToGhl(process.env.ACCOUNT_A_API, contact);
    console.log('✅ Sent to Account A GHL, id:', resp.data.id || resp.data);
    res.status(200).send('Sent to Account A');
  } catch (err) {
    console.error('❌ Error sending to Account A GHL:', err.response?.data || err.message);
    res.status(500).send('Error sending to Account A');
  }
});

app.post('/webhook2', async (req, res) => {
  const payload = req.body;
  console.log('📩 Account B Webhook:', payload);
  logToFile('accountB-log.json', payload);

  const contact = buildGhlContact(payload);
  if (!contact.email && !contact.phone) {
    console.log('⚠️ Skipping Account B: missing both email and phone');
    return res.status(400).send('Missing email or phone');
  }

  try {
    const resp = await upsertToGhl(process.env.ACCOUNT_B_API, contact);
    console.log('✅ Sent to Account B GHL, id:', resp.data.id || resp.data);
    res.status(200).send('Sent to Account B');
  } catch (err) {
    console.error('❌ Error sending to Account B GHL:', err.response?.data || err.message);
    res.status(500).send('Error sending to Account B');
  }
});

app.post('/webhook3', async (req, res) => {
  const payload = req.body;
  console.log('📩 Account C Webhook:', payload);
  logToFile('accountC-log.json', payload);

  const contact = buildGhlContact(payload);
  if (!contact.email && !contact.phone) {
    console.log('⚠️ Skipping Account C: missing both email and phone');
    return res.status(400).send('Missing email or phone');
  }

  try {
    const resp = await upsertToGhl(process.env.ACCOUNT_C_API, contact);
    console.log('✅ Sent to Account C GHL, id:', resp.data.id || resp.data);
    res.status(200).send('Sent to Account C');
  } catch (err) {
    console.error('❌ Error sending to Account C GHL:', err.response?.data || err.message);
    res.status(500).send('Error sending to Account C');
  }
});

/* ------------------ Health / env ------------------ */
app.get('/env-test', (req, res) => {
  res.json({
    accountA: process.env.ACCOUNT_A_API ? '✅ Loaded' : '❌ Missing',
    accountB: process.env.ACCOUNT_B_API ? '✅ Loaded' : '❌ Missing',
    accountC: process.env.ACCOUNT_C_API ? '✅ Loaded' : '❌ Missing',
    hubspot:  process.env.HUBSPOT_ACCESS_TOKEN ? '✅ Loaded' : '❌ Missing'
  });
});

app.get('/', (req, res) => {
  res.send('✅ Webhook server running.');
});

/* --------------- HubSpot single-contact UPSERT --------------- */
app.post('/webhook/ghl-to-hubspot', async (req, res) => {
  try {
    const properties = normalizeHubSpotContact(req.body || {});
    if (!properties.email) {
      return res.status(400).json({ status: 'error', message: 'Missing required field: email' });
    }

    const hs = axios.create({
      baseURL: 'https://api.hubapi.com',
      headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      timeout: 15000
    });

    // Search by email
    const searchBody = {
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: properties.email }] }],
      properties: Object.keys(properties),
      limit: 1
    };

    const search = await hs.post('/crm/v3/objects/contacts/search', searchBody);
    const existing = search.data?.results?.[0] || null;

    if (existing) {
      const id = existing.id;
      const update = await hs.patch(`/crm/v3/objects/contacts/${id}`, { properties });
      return res.status(200).json({ status: 'updated', id, data: update.data });
    } else {
      const create = await hs.post('/crm/v3/objects/contacts', { properties });
      return res.status(200).json({ status: 'created', id: create.data.id, data: create.data });
    }
  } catch (error) {
    const details = error.response?.data || error.message;
    console.error('❌ HubSpot single upsert error:', details);
    return res.status(500).json({ status: 'error', error: details });
  }
});

/* --------------- HubSpot batch UPSERT (by email) --------------- */
app.post('/webhook/ghl-to-hubspot-batch', async (req, res) => {
  try {
    const items = Array.isArray(req.body.contacts) ? req.body.contacts : [];
    if (!items.length) {
      return res.status(400).json({ status: 'error', message: 'Body must include contacts[]' });
    }

    // Batch limit 100
    const chunk = (arr, size) => arr.reduce((a, _, i) => (i % size ? a : [...a, arr.slice(i, i + size)]), []);
    const chunks = chunk(items, 100);

    const hs = axios.create({
      baseURL: 'https://api.hubapi.com',
      headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      timeout: 20000
    });

    const results = [];
    for (const group of chunks) {
      const inputs = group.map(c => ({
        idProperty: 'email',
        properties: normalizeHubSpotContact(c)
      }));
      const resp = await hs.post('/crm/v3/objects/contacts/batch/upsert', { inputs });
      results.push(resp.data);
    }

    return res.status(200).json({ status: 'success', chunks: results.length, results });
  } catch (error) {
    const details = error.response?.data || error.message;
    console.error('❌ HubSpot batch upsert error:', details);
    return res.status(500).json({ status: 'error', error: details });
  }
});
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json()); // 👈 needed to parse webhook JSON

// ── WEBHOOK (Send to Account B) ───────────────────────────────
app.post('/webhook/new-ghl-account', async (req, res) => {
  const payload = req.body;
  console.log('📩 Incoming payload:', JSON.stringify(payload, null, 2));

  const contact = {
    firstName: payload.firstName ?? payload.contact?.first_name,
    lastName:  payload.lastName  ?? payload.contact?.last_name,
    email:     payload.email     ?? payload.contact?.email,
    phone:     payload.phone     ?? payload.contact?.phone,
    tags: Array.isArray(payload.tags)
      ? payload.tags
      : Array.isArray(payload.contact?.tags) ? payload.contact.tags : [],
    locationId: process.env.NEW_GHL_LOCATION_ID, // 👈 goes in body
  };

  if (!contact.email && !contact.phone) {
    console.log('⚠️ Skipping: missing both email and phone');
    return res.status(400).send('Missing email or phone');
  }

  try {
    const resp = await axios.post(
      'https://services.leadconnectorhq.com/contacts/',
      contact,
      {
        headers: {
          Authorization: `Bearer ${process.env.NEW_GHL_API}`, // 👈 Location API Key
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Version': '2021-07-28',
        },
        timeout: 15000,
      }
    );

    console.log('✅ Contact created:', resp.status, resp.data);
    return res
      .status(200)
      .send(`Sent to Account B (id: ${resp.data?.id ?? 'unknown'})`);
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    console.error('❌ Error sending to Account B:', status, data || err.message);
    return res
      .status(500)
      .send(`Error sending to Account B: ${status ?? ''}`);
  }
});

app.listen(port, () => {
  console.log(`🚀 Webhook server listening on port ${port}`);
});


/* ------------------------- Start ------------------------- */
app.listen(port, () => {
  console.log(`🚀 Webhook server listening on port ${port}`);
});





