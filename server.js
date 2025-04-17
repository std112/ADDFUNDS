const express = require('express');
const axios = require('axios');
const fs = require('fs');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = 3000;
const STEAM_API_KEY = 'D71C09AA4CB79F55A8E9363B5CDC439F'; // Your Steam API Key

// Load balances from file
function loadBalances() {
  return JSON.parse(fs.readFileSync('db.json', 'utf8'));
}

// Save balances to file
function saveBalances(balances) {
  fs.writeFileSync('db.json', JSON.stringify(balances, null, 2));
}

// Resolve SteamID from profile URL
async function getSteamID(steamUrl) {
  if (steamUrl.includes('/id/')) {
    const customId = steamUrl.split('/id/')[1].split('/')[0];
    const res = await axios.get(`http://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${STEAM_API_KEY}&vanityurl=${customId}`);
    return res.data.response.steamid;
  } else if (steamUrl.includes('/profiles/')) {
    return steamUrl.split('/profiles/')[1].split('/')[0];
  } else {
    throw new Error('Invalid Steam URL format');
  }
}

// Main route: Fetch Steam info
app.post('/api/steam-info', async (req, res) => {
  const { steamUrl } = req.body;

  try {
    const steamId = await getSteamID(steamUrl);
    const balances = loadBalances();

    // If banned, deny access
    if (balances[steamId]?.banned) {
      return res.status(403).json({ error: 'This user is banned.' });
    }

    // Create new record if not found
    if (!balances[steamId]) {
      balances[steamId] = {
        balance: 0,
        banned: false,
        warning: ''
      };
      saveBalances(balances);
    }

    const [profileRes, levelRes] = await Promise.all([
      axios.get(`http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamId}`),
      axios.get(`http://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${STEAM_API_KEY}&steamid=${steamId}`)
    ]);

    const player = profileRes.data.response.players[0];
    const level = levelRes.data.response.player_level;

    res.json({
      steamId,
      personaName: player.personaname,
      avatar: player.avatarfull,
      level,
      balance: balances[steamId].balance || 0,
      warning: balances[steamId].warning || ''
    });

  } catch (err) {
    console.error(err);
    res.status(400).json({ error: 'Failed to fetch Steam info' });
  }
});


// Admin: Get all users
app.get('/api/users', (req, res) => {
  const balances = loadBalances();
  res.json(balances);
});

// Admin: Update only balance
app.post('/api/update-balance', (req, res) => {
  const { steamId, balance } = req.body;

  if (!steamId || typeof balance !== 'number') {
    return res.status(400).json({ error: 'Invalid data' });
  }

  const balances = loadBalances();
  if (!balances[steamId]) balances[steamId] = {};
  balances[steamId].balance = balance;
  saveBalances(balances);

  res.json({ success: true });
});

// Admin: Update balance + warning
app.post('/api/update-user', (req, res) => {
  const { steamId, balance, warning } = req.body;

  if (!steamId) return res.status(400).json({ error: 'Missing steamId' });

  const balances = loadBalances();
  if (!balances[steamId]) balances[steamId] = {};

  balances[steamId].balance = typeof balance === 'number' ? balance : 0;
  balances[steamId].warning = warning || '';
  saveBalances(balances);

  res.json({ success: true });
});

// Admin: Toggle ban status
app.post('/api/toggle-ban', (req, res) => {
  const { steamId } = req.body;

  if (!steamId) return res.status(400).json({ error: 'Missing steamId' });

  const balances = loadBalances();
  if (!balances[steamId]) balances[steamId] = { balance: 0, banned: false, warning: '' };

  balances[steamId].banned = !balances[steamId].banned;
  saveBalances(balances);

  res.json({ banned: balances[steamId].banned });
});

// Frontend: Get warning message for current user
app.post('/api/get-warning', (req, res) => {
  const { steamId } = req.body;

  if (!steamId) {
    return res.status(400).json({ error: 'Missing steamId' });
  }

  const balances = loadBalances();
  const warning = balances[steamId]?.warning || '';

  res.json({ warning }); // ✅ Just respond, don't log it
});



// Start server

// Admin: Remove a user completely
app.post('/api/remove-user', (req, res) => {
  const { steamId } = req.body;

  if (!steamId) {
    return res.status(400).json({ error: 'Missing steamId' });
  }

  const balances = loadBalances();
  if (balances[steamId]) {
    delete balances[steamId];
    saveBalances(balances);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});



// Admin: Add a new user manually
app.post('/api/add-user', async (req, res) => {
  const { steamUrl, balance, warning } = req.body;

  if (!steamUrl) return res.status(400).json({ error: 'Missing Steam profile URL' });

  try {
    const steamId = await getSteamID(steamUrl);
    const balances = loadBalances();

    balances[steamId] = {
      balance: typeof balance === 'number' ? balance : 0,
      warning: warning || '',
      banned: false
    };

    saveBalances(balances);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: 'Failed to resolve Steam ID' });
  }
});


app.listen(PORT, () => {
  console.log(`✅ Backend running at http://localhost:${PORT}`);
});
