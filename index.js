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
    GatewayIntentBits.MessageContent
  ]
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_ID = process.env.ADMIN_ID;

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
}
initDB().catch(console.error);

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
    res.status(500).json({ error: 'DB error' });
  }
});

// Отдача основного скрипта
app.post('/run', async (req, res) => {
  try {
    const { token } = req.body;
    const result = await pool.query('SELECT 1 FROM my_table WHERE token=$1', [token]);
    if (result.rowCount === 0) {
      return res.status(403).send('// Ключ невалидный');
    }

    const scriptUrl = 'https://bondyuk777.github.io/-/dadwadfafaf.js';
    const response = await fetch(scriptUrl);
    if (!response.ok) {
      return res.status(500).send('// Ошибка загрузки основного скрипта');
    }
    const jsCode = await response.text();

    res.setHeader('Content-Type', 'application/javascript');
    res.send(jsCode);

  } catch (err) {
    console.error(err);
    res.status(500).send('// Ошибка сервера');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ===== События Discord-бота =====
client.on('ready', () => console.log(`Logged in as ${client.user.tag}!`));

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.author.id !== ADMIN_ID) return;

  const args = message.content.trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  if (cmd === '!addtoken') {
    const token = args[0];
    if (!token) return message.reply('Укажи токен!');
    await pool.query('INSERT INTO my_table(token) VALUES($1)', [token]);
    message.reply(`Токен ${token} добавлен.`);
  }

  if (cmd === '!deltoken') {
    const token = args[0];
    if (!token) return message.reply('Укажи токен!');
    const res = await pool.query('DELETE FROM my_table WHERE token=$1', [token]);
    if (res.rowCount === 0) return message.reply('Такого токена нет!');
    message.reply(`Токен ${token} удалён.`);
  }

  if (cmd === '!listtokens') {
    const res = await pool.query('SELECT token FROM my_table');
    message.reply('Токены: ' + (res.rows.map(r => r.token).join(', ') || 'нет'));
  }
});

client.login(BOT_TOKEN);
