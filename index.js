// index.js
const { Client, GatewayIntentBits } = require('discord.js');
const { Pool } = require('pg');
const express = require('express');
const cors = require('cors');

// fetch встроен в Node.js 18+
const fetch = global.fetch;

// ===== Discord и PostgreSQL =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages // для ЛС
  ],
  partials: ["CHANNEL"] // чтобы бот видел ЛС
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_ID = process.env.ADMIN_ID;

// ===== Вебхук для логов =====
const LOG_WEBHOOK = "https://discord.com/api/webhooks/1414267869042053141/cg_p7zfGWSBTQyz2p-XCrs9OPIKPST29-xpxU1GRE7c9Unu8ipWDJvff6ODC69kNMJGF";

// функция отправки логов
async function sendLog(text) {
  try {
    await fetch(LOG_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text })
    });
  } catch (err) {
    console.error("Ошибка отправки лога:", err);
  }
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ===== Инициализация базы =====
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS my_table (
      id SERIAL PRIMARY KEY,
      token TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('Database initialized.');
  await sendLog("✅ База данных инициализирована.");
}
initDB().catch(err => {
  console.error(err);
  sendLog("❌ Ошибка инициализации БД: " + err.message);
});

// ===== Express сервер =====
const app = express();
app.use(cors()); 
app.use(express.json()); 

app.get('/', (req, res) => res.send('Bot is alive!'));

// Проверка токена
app.get('/check/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const result = await pool.query('SELECT 1 FROM my_table WHERE token=$1', [token]);
    res.json({ valid: result.rowCount > 0 });
  } catch (err) {
    console.error(err);
    await sendLog("❌ Ошибка проверки токена: " + err.message);
    res.status(500).json({ error: 'DB error' });
  }
});

// Отдача основного скрипта
app.post('/run', async (req, res) => {
  try {
    const { token } = req.body;
    const result = await pool.query('SELECT 1 FROM my_table WHERE token=$1', [token]);
    if (result.rowCount === 0) {
      await sendLog(`⛔ Запрос с невалидным токеном: ${token}`);
      return res.status(403).send('// Ключ невалидный');
    }

    const scriptUrl = 'https://bondyuk777.github.io/-/dadwadfafaf.js';
    const response = await fetch(scriptUrl);
    if (!response.ok) {
      await sendLog("❌ Ошибка загрузки основного скрипта");
      return res.status(500).send('// Ошибка загрузки основного скрипта');
    }
    const jsCode = await response.text();

    res.setHeader('Content-Type', 'application/javascript');
    res.send(jsCode);
    await sendLog(`📤 Скрипт отдан для токена: ${token}`);
  } catch (err) {
    console.error(err);
    await sendLog("❌ Ошибка /run: " + err.message);
    res.status(500).send('// Ошибка сервера');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  sendLog(`🚀 Сервер запущен на порту ${PORT}`);
});

// ===== События Discord-бота =====
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  sendLog(`🤖 Бот авторизовался как ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Команды доступны только админу
  if (message.author.id === ADMIN_ID) {
    const args = message.content.trim().split(/\s+/);
    const cmd = args.shift().toLowerCase();

    if (cmd === '!addtoken') {
      const token = args[0];
      if (!token) return message.author.send('Укажи токен!');
      await pool.query('INSERT INTO my_table(token) VALUES($1)', [token]);
      await message.author.send(`✅ Токен ${token} добавлен.`);
      if (message.guild) message.reply('✅ Ответ отправлен тебе в ЛС.');
      await sendLog(`➕ Админ добавил токен: ${token}`);
    }

    if (cmd === '!deltoken') {
      const token = args[0];
      if (!token) return message.author.send('Укажи токен!');
      const res = await pool.query('DELETE FROM my_table WHERE token=$1', [token]);
      if (res.rowCount === 0) {
        await message.author.send('Такого токена нет!');
        return await sendLog(`⚠️ Попытка удалить несуществующий токен: ${token}`);
      }
      await message.author.send(`❌ Токен ${token} удалён.`);
      if (message.guild) message.reply('✅ Ответ отправлен тебе в ЛС.');
      await sendLog(`➖ Админ удалил токен: ${token}`);
    }

    if (cmd === '!listtokens') {
      const res = await pool.query('SELECT token FROM my_table');
      await message.author.send('🔑 Токены: ' + (res.rows.map(r => r.token).join(', ') || 'нет'));
      if (message.guild) message.reply('✅ Ответ отправлен тебе в ЛС.');
      await sendLog("📋 Админ запросил список токенов");
    }
  }

  // Если кто-то пишет в ЛС (channel.type === 1)
  if (message.channel.type === 1) {
    try {
      await message.author.send(`Ты написал мне: "${message.content}"`);
      await sendLog(`💌 ЛС от ${message.author.tag}: ${message.content}`);
    } catch (err) {
      console.error('Не смог отправить ЛС:', err);
      await sendLog(`❌ Ошибка ответа в ЛС ${message.author.tag}: ${err.message}`);
    }
  }
});

client.login(BOT_TOKEN);

// ===== Самопинг, чтобы Render не засыпал слишком надолго =====
setInterval(() => {
  fetch(`https://adadadadad-97sj.onrender.com/check/1`).catch(() => {});
}, 5 * 60 * 1000); // каждые 5 минут
