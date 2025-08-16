// ChildBotHost V2 - Backend/server.js
// A fresh, simple, and reliable server code.

const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// --- Data Persistence Setup ---
const DATA_DIR = path.join(__dirname, 'data');
const BOTS_FILE = path.join(DATA_DIR, 'bots.json');
const COMMANDS_FILE = path.join(DATA_DIR, 'commands.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// --- In-memory Stores ---
let bots = {};      // { botId: { token, name, instance, status } }
let commands = {};  // { botId: { command: code } }

// --- Helper Functions ---
function saveData() {
    try {
        const botsToSave = Object.fromEntries(
            Object.entries(bots).map(([id, { token, name, status }]) => [id, { token, name, status }])
        );
        fs.writeFileSync(BOTS_FILE, JSON.stringify(botsToSave, null, 2));
        fs.writeFileSync(COMMANDS_FILE, JSON.stringify(commands, null, 2));
    } catch (error) {
        console.error('⚠️ Could not save data:', error);
    }
}

function loadData() {
    try {
        if (fs.existsSync(BOTS_FILE)) {
            const rawData = fs.readFileSync(BOTS_FILE);
            const loadedBots = JSON.parse(rawData);
            Object.keys(loadedBots).forEach(id => {
                bots[id] = { ...loadedBots[id], instance: null };
            });
        }
        if (fs.existsSync(COMMANDS_FILE)) {
            commands = JSON.parse(fs.readFileSync(COMMANDS_FILE));
        }
        console.log('✅ Data loaded successfully.');
    } catch (error) {
        console.error('⚠️ Could not load data:', error);
    }
}

// --- Bot Management ---
function launchBot(botId) {
    const bot = bots[botId];
    if (!bot || bot.status === 'RUN') return;

    try {
        bot.instance = new Telegraf(bot.token);
        const botCommands = commands[botId] || {};
        
        // Register all commands
        for (const cmdName in botCommands) {
            bot.instance.command(cmdName, (ctx) => {
                try {
                    new Function('ctx', botCommands[cmdName])(ctx);
                } catch (e) {
                    ctx.reply(`⚠️ Error in /${cmdName}: ${e.message}`);
                }
            });
        }
        
        bot.instance.launch();
        bot.status = 'RUN';
        console.log(`🚀 Bot '${bot.name}' is now running.`);
    } catch (error) {
        console.error(`Error launching bot ${bot.name}:`, error);
        bot.status = 'STOP';
    }
    saveData();
}

function stopBot(botId) {
    const bot = bots[botId];
    if (!bot || bot.status === 'STOP') return;

    if (bot.instance) {
        bot.instance.stop('SIGTERM');
        bot.instance = null;
    }
    bot.status = 'STOP';
    console.log(`🛑 Bot '${bot.name}' has been stopped.`);
    saveData();
}

// ======================= API Endpoints =======================

// --- Frontend Route (The main fix) ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/index.html'));
});

// --- Bot APIs ---
app.get('/getBots', (req, res) => {
    const botList = Object.entries(bots).map(([botId, { name, status }]) => ({ botId, name, status }));
    res.json(botList);
});

app.post('/createBot', async (req, res) => {
    const { token, name } = req.body;
    try {
        const tempBot = new Telegraf(token);
        await tempBot.telegram.getMe();
        
        const botId = `bot_${Date.now()}`;
        bots[botId] = { token, name, instance: null, status: 'STOP' };
        commands[botId] = { start: "ctx.reply('Hello from ChildBotHost V2!')" }; // Default start command
        saveData();
        res.status(201).json({ ok: true, botId });
    } catch (error) {
        res.status(400).json({ ok: false, message: 'Invalid Telegram token.' });
    }
});

app.post('/toggleBot', (req, res) => {
    const { botId } = req.body;
    if (!bots[botId]) return res.status(404).json({ ok: false });
    
    if (bots[botId].status === 'RUN') {
        stopBot(botId);
    } else {
        launchBot(botId);
    }
    res.json({ ok: true });
});

app.post('/deleteBot', (req, res) => {
    const { botId } = req.body;
    if (!bots[botId]) return res.status(404).json({ ok: false });
    
    stopBot(botId);
    delete bots[botId];
    delete commands[botId];
    saveData();
    res.json({ ok: true });
});

// --- Command APIs ---
app.get('/getCommands', (req, res) => {
    const { botId } = req.query;
    if (!commands[botId]) return res.json({});
    res.json(commands[botId]);
});

app.post('/saveCommand', (req, res) => {
    const { botId, name, code } = req.body;
    if (!bots[botId] || !name) return res.status(400).json({ ok: false });

    commands[botId][name] = code;
    // If bot is running, restart to apply changes
    if (bots[botId].status === 'RUN') {
        stopBot(botId);
        launchBot(botId);
    }
    saveData();
    res.json({ ok: true });
});

// ======================= Server Initialization =======================
const PORT = 3000;
app.listen(PORT, () => {
    console.log('------------------------------------');
    console.log(`⚡ ChildBotHost V2 server running on port ${PORT}`);
    loadData();
    // Restart any bots that were previously running
    Object.keys(bots).forEach(id => {
        if (bots[id].status === 'RUN') {
            launchBot(id);
        }
    });
    console.log('------------------------------------');
});
