// server.js
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// ==== Utility: logging =====
function logToFile(filename, data) {
  const entry = { timestamp: new Date().toISOString(), payload: data };
  fs.appendFile(filename, JSON.stringify(entry) + '\n', err => {
    if (err) console.error(`❌ Error writing to ${filename}:`, err);
    else console.log(`✅ Logged to ${filename}`);
  });
}

// ==== Utility: security (optional) =====
function assertSharedSecret(req, res) {
  const configured = process.env.SHARED_SECRET;
  if (!configured) return true; // not enforcing
  const incoming = req.headers['x-shared-secret'] || req.query.secret || (req.body && req.body.secret);
  if (incoming && String(incoming) === String(configured)) return true;
  res.status(401).json({ status: 'error', message: 'Unauthorized (shared secret missing/invalid)' });
  return false;
}

// ==== Utility: field normalization =====
function pick(payload, ...paths) {
  for (const p of paths) {
    const v = p.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), payload);
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

function ensureArrayTags(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    return v.split(',').map(t => t.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Build a LeadConnector contact payload with proper camelCase keys.
 * - payload: inbound JSON
 * - defaultTags: tags to always add (e.g., ["From Account A"])
 * - locationId: optional; include if your account requires it
 * - tagFromKeysRegex: optional regex; if a key matches and has a value, treat the value as a tag
 */
function buildContactPayload(payload, defaultTags = [], locationId = undefined, tagFromKeysRegex = undefined) {
  const email     = pick(payload, 'email', 'contact.email', 'contact.email_address');
  const phone     = pick(payload, 'phone', 'contact.phone', 'contact.phone_number');
  const firstName = pick(payload, 'firstName', 'firstname', 'first_name', 'contact.first_name', 'contact.firstname');
  const lastName  = pick(payload, 'lastName', 'lastname', 'last_name', 'contact.last_name', 'contact.lastname');

  let tags = ensureArrayTags(pick(payload, 'tags', 'contact.tags'));

  // Optionally treat certain key values as tags (e.g., competency_coach_* fields)
  if (tagFromKeysRegex) {
    for (const [k, v] of Object.entries(payload)) {
      if (!v) continue;
      if (tagFromKeysRegex.test(k)) tags.push(String(v).trim());
    }
  }

  // Prepend default/source tags and de-dup
  for (let i = defaultTags.length - 1; i >= 0; i--) {
    if (!tags.includes(defaultTags[i])) tags.unshift(defaultTags[i]);
  }
  tags = [...new Set(tags)].filter(Boolean);

  const contact = {};
  if (email) contact.email = email;
  if (phone) contact.phone = phone;
  if (firstName) contact.firstName = firstName; // camelCase for API
  if (lastName) contact.lastName = lastName;    // camelCase for API
  if (tags.length) contact.tags = tags;
  if (locationId) contact.locationId = locationId; // only if needed

  return contact;
}

async function upsertToGHL(apiKey, contact) {
  const resp = await axios.post(
    'https://rest.gohighlevel.com/v1/contacts/',
    contact,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // If you see "version required", uncomment the next line:
        // 'Version': '2021-07-28'
      },
      timeout: 15000
    }
  );
  return resp;
}

// ==== Env sanity check ====
console.log("🔍 Loaded ENV keys:", {
  ACCOUNT_A_API: !!process.env.ACCOUNT_A_API,
  ACCOUNT_B_API: !!process.env.ACCOUNT_B_API,
  ACCOUNT_C_API: !!process.env.ACCOUNT_C_API,
  NEW_GHL_API: !!process.env.NEW_GHL_API,
  HUBSPOT_ACCESS_TOKEN: !!process.env.HUBSPOT_ACCESS_TOKEN,
  SHARED_SECRET: !!process.env.SHARED_SECRET
});

// ===================== WEBHOOKS ===================== //

// Account A → its own GHL (if you need it)
app.post('/webhook', async (req, res) => {
  if (!assertSharedSecret(req, res)) return;
  const payload = req.body;
  console.log('📩 Account A inbound:', JSON.stringify(payload, null, 2));
  logToFile('accountA-log.json', { inbound: payload });

  const contact = buildContactPayload(
    payload,
    ['From Account A'],
    process.env.ACCOUNT_A_LOCATION_ID,
    /competency_coach/i // treat these key values as tags too, optional
  );

  if (!contact.email && !contact.phone) {
    console.log('⚠️ Skipping A: missing both email and phone');
    return res.status(400).json({ status: 'error', message: 'Missing email or phone' });
  }

  try {
    const resp = await upsertToGHL(process.env.ACCOUNT_A_API, contact);
    console.log('✅ A upsert:', resp.data);
    logToFile('accountA-log.json', { ghl_response: resp.data });
    return res.status(200).json({ status: 'success', data: resp.data });
  } catch (err) {
    const details = err.response?.data || err.message;
    console.error('❌ A error:', details);
    logToFile('accountA-log.json', { error: details });
    return res.status(500).json({ status: 'error', error: details });
  }
});

// Account A → Account B (your main path)
app.post('/webhook2', async (req, res) => {
  if (!assertSharedSecret(req, res)) return;
  const payload = req.body;
  console.log('📩 Account B inbound:', JSON.stringify(payload, null, 2));
  logToFile('accountB-log.json', { inbound: payload });

  const contact = buildContactPayload(
    payload,
    ['From Account A'], // source tag for Account B workflow filtering
    process.env.ACCOUNT_B_LOCATION_ID,
    /competency_coach/i
  );

  if (!contact.email && !contact.phone) {
    console.log('⚠️ Skipping B: missing both email and phone');
    return res.status(400).json({ status: 'error', message: 'Missing email or phone' });
  }

  console.log('→ Contact to GHL (B):', contact);

  try {
    const resp = await upsertToGHL(process.env.ACCOUNT_B_API, contact);
    console.log('✅ B upsert:', resp.data);
    logToFile('accountB-log.json', { ghl_response: resp.data });
    return res.status(200).json({ status: 'success', data: resp.data });
  } catch (err) {
    const details = err.response?.data || err.message;
    console.error('❌ B error:', details);
    logToFile('accountB-log.json', { error: details });
    return res.status(500).json({ status: 'error', error: details });
  }
});

// Account A → Account C (optional)
app.post('/webhook3', async (req, res) => {
  if (!assertSharedSecret(req, res)) return;
  const payload = req.body;
  console.log('📩 Account C inbound:', JSON.stringify(payload, null, 2));
  logToFile('accountC-log.json', { inbound: payload });

  const contact = buildContactPayload(
    payload,
    ['From Account A'],
    process.env.ACCOUNT_C_LOCATION_ID,
    /competency_coach/i
  );

  if (!contact.email && !contact.phone) {
    console.log('⚠️ Skipping C: missing both email and phone');
    return res.status(400).json({ status: 'error', message: 'Missing email or phone' });
  }

  try {
    const resp = await upsertToGHL(process.env.ACCOUNT_C_API, contact);
    console.log('✅ C upsert:', resp.data);
    logToFile('accountC-log.json', { ghl_response: resp.data });
    return res.status(200).json({ status: 'success', data: resp.data });
  } catch (err) {
    const details = err.response?.data || err.message;
    console.error('❌ C error:', details);
    logToFile('accountC-log.json', { error: details });
    return res.status(500).json({ status: 'error', error: details });
  }
});

// Health + env
app.get('/env-test', (req, res) => {
  res.json({
    accountA: process.env.ACCOUNT_A_API ? '✅ Loaded' : '❌ Missing',
    accountB: process.env.ACCOUNT_B_API ? '✅ Loaded' : '❌ Missing',
    accountC: process.env.ACCOUNT_C_API ? '✅ Loaded' : '❌ Missing',
    newGhl: process.env.NEW_GHL_API ? '✅ Loaded' : '❌ Missing',
    hubspot: process.env.HUBSPOT_ACCESS_TOKEN ? '✅ Loaded' : '❌ Missing'
  });
});

app.get('/', (req, res) => {
  res.send('✅ Webhook server running.');
});

// GHL → HubSpot bridge (unchanged, returns JSON)
app.post('/webhook/ghl-to-hubspot', async (req, res) => {
  if (!assertSharedSecret(req, res)) return;
  try {
    const {
      email,
      firstname,
      lastname,
      phone,
      source,
      tags,
      investor_archetype_ppt_frequency,
      investor_archetype_ppt_profile,
      investor_archetype_free_ppt_frequency
    } = req.body;

    if (!email) {
      return res.status(400).json({ status: 'error', message: 'Missing required field: email' });
    }

    const hubspotData = {
      properties: {
        email: email || '',
        firstname: firstname || '',
        lastname: lastname || '',
        phone: phone || '',
        source: source || '',
        tags: Array.isArray(tags) ? tags.join(',') : (tags || ''),
        investor_archetype_ppt_frequency: investor_archetype_ppt_frequency || '',
        investor_archetype_ppt_profile: investor_archetype_ppt_profile || '',
        investor_archetype_free_ppt_frequency: investor_archetype_free_ppt_frequency || ''
      }
    };

    const hubspotResponse = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/contacts',
      hubspotData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`
        },
        timeout: 15000
      }
    );

    console.log('✅ HubSpot upsert:', hubspotResponse.data);
    res.status(200).json({ status: 'success', data: hubspotResponse.data });
  } catch (error) {
    console.error('❌ HubSpot Error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      error: error.response?.data || error.message
    });
  }
});

// New GHL account route (if you need to target another location)
app.post('/webhook/new-ghl-account', async (req, res) => {
  if (!assertSharedSecret(req, res)) return;
  const payload = req.body;
  console.log('📩 New GHL inbound:', JSON.stringify(payload, null, 2));
  logToFile('new-ghl-log.json', { inbound: payload });

  const contact = buildContactPayload(
    payload,
    ['From Account A'],
    process.env.NEW_GHL_LOCATION_ID,
    /competency_coach/i
  );

  if (!contact.email && !contact.phone) {
    console.log('⚠️ Skipping new GHL: missing both email and phone');
    return res.status(400).json({ status: 'error', message: 'Missing email or phone' });
  }

  try {
    const resp = await upsertToGHL(process.env.NEW_GHL_API, contact);
    console.log('✅ New GHL upsert:', resp.data);
    logToFile('new-ghl-log.json', { ghl_response: resp.data });
    res.status(200).json({ status: 'success', data: resp.data });
  } catch (err) {
    const details = err.response?.data || err.message;
    console.error('❌ New GHL error:', details);
    logToFile('new-ghl-log.json', { error: details });
    res.status(500).json({ status: 'error', error: details });
  }
});

app.listen(port, () => {
  console.log(`🚀 Webhook server listening on port ${port}`);
});


