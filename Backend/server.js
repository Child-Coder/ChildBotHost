// ChildBotHost – Backend/server.js
require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// ---------- App & Static Files Setup ----------
const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));
// REMOVED: app.use(express.static(path.join(__dirname, '../Frontend'))); // This line was removed as it was causing the issue.

// ---------- Persistence Setup ----------
const DATA_DIR = path.join(__dirname, 'data');
const BOTS_FILE = path.join(DATA_DIR, 'bots.json');
const COMMANDS_FILE = path.join(DATA_DIR, 'commands.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// In-memory stores (will be populated from files)
let bots = {};      // { botId: {token, name, instance:Telegraf|null, status:'STOP'|'RUN'} }
let commands = {};  // { botId: { "start": "code", ... } }

// ---------- Persistence Helpers ----------
function saveData() {
  try {
    const botsToSave = {};
    Object.keys(bots).forEach(id => {
      const { token, name, status } = bots[id];
      botsToSave[id] = { token, name, status };
    });
    fs.writeFileSync(BOTS_FILE, JSON.stringify(botsToSave, null, 2));
    fs.writeFileSync(COMMANDS_FILE, JSON.stringify(commands, null, 2));
  } catch (error) {
    console.error('⚠️ Error saving data:', error);
  }
}

function loadData() {
  try {
    if (fs.existsSync(BOTS_FILE)) {
      const rawBots = fs.readFileSync(BOTS_FILE);
      const loadedBots = JSON.parse(rawBots);
      Object.keys(loadedBots).forEach(id => {
        bots[id] = { ...loadedBots[id], instance: null };
      });
    }
    if (fs.existsSync(COMMANDS_FILE)) {
      const rawCmds = fs.readFileSync(COMMANDS_FILE);
      commands = JSON.parse(rawCmds);
    }
    console.log('✅ Data loaded successfully.');
  } catch (error) {
    console.error('⚠️ Error loading data:', error);
    bots = {};
    commands = {};
  }
}

// ---------- Bot Logic (No Changes Here) ----------
/********************************************************************
 * SECURITY WARNING: The use of `new Function('ctx', code)` allows  *
 * for Remote Code Execution (RCE). Any user with access to this    *
 * panel can run arbitrary code on the server. This is EXTREMELY   *
 * DANGEROUS. Use this tool only in a trusted, isolated environment.*
 ********************************************************************/
function registerHandlers(instance, botId) {
  instance.context.updateTypes = [];
  const defaultStartCode = "ctx.reply('🚀 ChildBotHost bot online!')";
  const startCode = (commands[botId] && commands[botId]['start']) || defaultStartCode;
  
  instance.command('start', ctx => {
    try {
      new Function('ctx', startCode)(ctx);
    } catch (e) {
      console.error(`Error in /start for bot ${botId}:`, e);
      ctx.reply('⚠️ /start code error: ' + e.message);
    }
  });

  const botCmds = commands[botId] || {};
  Object.keys(botCmds).forEach(cmdName => {
    if (cmdName === 'start') return;
    instance.command(cmdName, ctx => {
      try {
        new Function('ctx', botCmds[cmdName])(ctx);
      } catch (e) {
        console.error(`Error in /${cmdName} for bot ${botId}:`, e);
        ctx.reply(`⚠️ Code error in /${cmdName}: ` + e.message);
      }
    });
  });

  instance.command('ping', ctx => {
    const t0 = Date.now();
    ctx.reply('🏓 Pong!').then(sentMessage => {
        const t1 = sentMessage.date * 1000;
        ctx.replyWithMarkdownV2(`*Round\\-trip*: ${t1 - t0} ms`);
    }).catch(console.error);
  });
}

function launchBot(botId) {
  const botCfg = bots[botId];
  if (!botCfg || botCfg.status === 'RUN') return;

  try {
    botCfg.instance = new Telegraf(botCfg.token);
    registerHandlers(botCfg.instance, botId);
    botCfg.instance.launch({ polling: { timeout: 3 } });
    botCfg.status = 'RUN';
    console.log(`✅ Bot '${botCfg.name}' started successfully.`);
  } catch (error) {
    console.error(`⚠️ Failed to launch bot '${botCfg.name}':`, error);
    botCfg.status = 'STOP';
  }
  saveData();
}

function stopBot(botId) {
  const botCfg = bots[botId];
  if (!botCfg || botCfg.status === 'STOP') return;

  if (botCfg.instance) {
    try {
      botCfg.instance.stop('SIGTERM');
      console.log(`🛑 Bot '${botCfg.name}' stopped.`);
    } catch (error) {
      console.error(`⚠️ Error stopping bot '${botCfg.name}':`, error);
    }
    botCfg.instance = null;
  }
  botCfg.status = 'STOP';
  saveData();
}

// ======================= THE FIX =======================
// This new section explicitly serves the HTML file for the main page.
// This is more reliable than using express.static in some environments.
app.get('/', (req, res) => {
    try {
        const indexPath = path.join(__dirname, '../Frontend/index.html');
        res.sendFile(indexPath);
    } catch (error) {
        res.status(500).send('Error loading the page. Check server logs.');
        console.error('Failed to send index.html:', error);
    }
});
// ========================================================


// ---------- API Endpoints (No Changes Here) ----------
app.post('/createBot', async (req, res) => {
  const { token, name } = req.body;
  if (!token || !name) {
    return res.status(400).json({ ok: false, message: 'Token and name are required.' });
  }

  try {
    const tmp = new Telegraf(token);
    await tmp.telegram.getMe();
    const id = Math.random().toString(36).substring(2, 15);
    bots[id] = { token, name, instance: null, status: 'STOP' };
    commands[id] = {};
    saveData();
    res.status(201).json({ ok: true, botId: id });
  } catch (e) {
    res.status(400).json({ ok: false, message: 'Invalid or expired Telegram token.' });
  }
});

app.post('/deleteBot', (req, res) => {
  const { botId } = req.body;
  if (!bots[botId]) return res.status(404).json({ ok: false, message: 'Bot not found.' });
  stopBot(botId);
  delete bots[botId];
  delete commands[botId];
  saveData();
  res.json({ ok: true });
});

app.post('/startBot', (req, res) => {
  const { botId } = req.body;
  if (!bots[botId]) return res.status(404).json({ ok: false, message: 'Bot not found.' });
  launchBot(botId);
  res.json({ ok: true });
});

app.post('/stopBot', (req, res) => {
  const { botId } = req.body;
  if (!bots[botId]) return res.status(404).json({ ok: false, message: 'Bot not found.' });
  stopBot(botId);
  res.json({ ok: true });
});

app.post('/addCommand', (req, res) => {
  const { botId, name, code } = req.body;
  const commandName = name.replace('/', '');
  if (!bots[botId]) return res.status(404).json({ ok: false, message: 'Bot not found.' });
  
  commands[botId] = commands[botId] || {};
  commands[botId][commandName] = code;

  if (bots[botId].status === 'RUN') {
    stopBot(botId);
    launchBot(botId);
  }
  
  saveData();
  res.json({ ok: true });
});

app.post('/delCommand', (req, res) => {
  const { botId, name } = req.body;
  const commandName = name.replace('/', '');
  if (!commands[botId] || !commands[botId][commandName]) {
    return res.status(404).json({ ok: false, message: 'Command not found.' });
  }
  
  delete commands[botId][commandName];
  
  if (bots[botId].status === 'RUN') {
    stopBot(botId);
    launchBot(botId);
  }
  
  saveData();
  res.json({ ok: true });
});

app.get('/getBots', (_, res) => {
  const list = Object.entries(bots).map(([id, b]) => ({
    botId: id,
    name: b.name,
    status: b.status,
  }));
  res.json(list);
});

app.get('/getCommands', (req, res) => {
  const { botId } = req.query;
  if (!commands[botId]) return res.json({});
  res.json(commands[botId]);
});


// ---------- Server Initialization ----------
process.on('uncaughtException', (err) => console.error('UNCAUGHT EXCEPTION:', err));
process.on('unhandledRejection', (reason) => console.error('UNHANDLED REJECTION:', reason));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('------------------------------------');
  console.log(`⚡ ChildBotHost server running on :${PORT}`);
  
  loadData();
  console.log('🔄 Restoring running bots...');
  Object.keys(bots).forEach(botId => {
    if (bots[botId].status === 'RUN') {
      launchBot(botId);
    }
  });
  console.log('------------------------------------');
});
