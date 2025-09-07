// index.js
const { Client, GatewayIntentBits } = require('discord.js');
const { Pool } = require('pg');
const express = require('express');
const cors = require('cors');

// fetch встроен в Node.js 18+
const fetch = global.fetch;

// ===== Функция для шифровки ссылок =====
(function () {
  const key = 'a'.charCodeAt(0) - 55; // 42

  function decode(arr) {
    return arr.map(c => String.fromCharCode(c ^ key)).join('');
  }

  const parts = {
    webhook: [
      82, 82, 82, 94, 94, 89, 94, 94, 94, 87, 82, 89, 94, 89, 94, 82, 82, 82,
      91, 82, 95, 86, 84, 86, 95, 94, 91, 86, 82, 82, 95, 82, 90, 82, 82, 95,
      86, 82, 84, 82, 95, 95, 91, 95, 94, 82, 86, 95, 84, 84, 95, 94, 82, 82,
      95, 94, 91, 95, 95, 82, 86, 91, 95, 91, 95, 82, 86, 84, 82, 91, 94, 91,
      95, 94, 82, 84, 91, 91, 82, 95, 86, 95, 91, 86, 95, 82, 84, 82, 91, 91,
      82, 95, 86, 95, 91, 86, 95, 82, 84, 91, 91, 82, 95, 82, 82, 95, 94, 82,
      95, 82, 82, 95, 86, 91, 95, 91, 95, 82, 84, 91, 91, 82, 95, 82, 82, 95,
      94, 82, 95, 91, 91, 95, 82, 86, 95, 82, 84, 82, 91, 95, 82, 95, 82, 84,
      95, 82, 84, 91, 82, 84, 91, 91, 82, 91, 95, 91, 82, 84, 95, 82, 82, 91,
      82, 91, 82, 84, 82, 91, 82, 91, 95, 82, 84, 91, 82, 84, 91, 91, 82, 91,
      82, 82, 95, 82, 95, 91, 82, 95, 82, 95, 91, 91, 82, 91, 82, 84, 82, 95,
      82, 82, 91, 82, 91, 91, 82, 84, 91, 95, 82, 91, 91, 82, 82, 91, 91, 82,
      91, 91, 82, 84, 91, 82, 95, 91, 91, 82, 84, 95, 82, 91, 82, 84, 95, 91,
      95, 91, 82, 95, 82, 84, 91, 91, 82, 95, 82, 84, 91, 91, 82, 84, 91, 95,
      91, 91, 82, 91, 82, 95, 91, 91, 82, 95, 82, 82, 91, 91, 95, 91, 82, 91,
      91, 95, 91, 91, 95, 91, 91, 82, 84, 91, 91, 95, 91, 82, 95, 82, 91, 82,
      84, 91, 91, 82, 91, 91, 95, 91, 95, 91, 82, 84, 91, 91, 95, 91, 82, 91,
      91, 95, 91, 95, 91, 82, 84, 91, 91, 95, 91, 82, 91, 91, 95, 91, 95, 91,
      82, 84, 91, 91, 95, 91, 82, 91, 91, 95, 91, 95, 91, 82, 84, 91, 91, 95,
      91, 82, 91, 91, 95, 91, 95, 91
    ],
    github: [
      82, 82, 82, 94, 94, 89, 94, 94, 94, 87, 82, 89, 94, 89, 94, 82, 82, 82,
      91, 82, 95, 86, 84, 86, 95, 94, 91, 86, 82, 82, 95, 82, 90, 82, 82, 95,
      86, 82, 84, 82, 95, 95, 91, 95, 94, 82, 86, 95, 84, 84, 95, 94, 82, 82,
      95, 94, 91, 95, 95, 82, 86, 91, 95, 91, 95, 82, 86, 84, 82, 91, 94, 91,
      95, 94, 82, 84, 91, 91, 82, 95, 86, 95, 91, 86, 95, 82, 84, 82, 91, 91,
      82, 95, 86, 95, 91, 86, 95, 82, 84, 91, 91, 82, 95, 82, 82, 95, 94, 82,
      95, 82, 82, 95, 86, 91, 95, 91, 95, 82, 84, 91, 91, 82, 95, 82, 82, 95,
      94, 82, 95, 91, 91, 95, 82, 86, 95, 82, 84, 82, 91, 95, 82, 95, 82, 84,
      95, 82, 84, 91, 82, 84, 91, 91, 82, 91, 95, 91, 82, 84, 95, 82, 82, 91,
      82, 91, 82, 84, 82, 91, 82, 91, 95, 82, 84, 91, 82, 84, 91, 91, 82, 91,
      82, 82, 95, 82, 95, 91, 82, 95, 82, 95, 91, 91, 82, 91, 82, 84, 82, 95,
      82, 82, 91, 82, 91, 91, 82, 84, 91, 95, 82, 91, 91, 82, 82, 91, 91, 82,
      91, 91, 82, 84, 91, 82, 95, 91, 91, 82, 84, 95, 82, 91, 82, 84, 95, 91,
      95, 91, 82, 95, 82, 84, 91, 91, 82, 95, 82, 84, 91, 91, 82, 84, 91, 95,
      91, 91, 82, 91, 82, 95, 91, 91, 82, 95, 82, 82, 91, 91, 95, 91, 82, 91,
      91, 95, 91, 91, 95, 91, 91, 82, 84, 91, 91, 95, 91, 82, 95, 82, 91, 82,
      84, 91, 91, 82, 91, 91, 95, 91, 95, 91, 82, 84, 91, 91, 95, 91, 82, 91,
      91, 95, 91, 95, 91, 82, 84, 91, 91, 95, 91, 82, 91, 91, 95, 91, 95, 91,
      82, 84, 91, 91, 95, 91, 82, 91, 91, 95, 91, 95, 91, 82, 84, 91, 91, 95,
      91, 82, 91, 91, 95, 91, 95, 91
    ],
    render: [
      82, 82, 82, 94, 94, 89, 94, 94, 94, 87, 82, 89, 94, 89, 94, 82, 82, 82,
      91, 82, 95, 86, 84, 86, 95, 94, 91, 86, 82, 82, 95, 82, 90, 82, 82, 95,
      86, 82, 84, 82, 95, 95, 91, 95, 94, 82, 86, 95, 84, 84, 95, 94, 82, 82,
      95, 94, 91, 95, 95, 82, 86, 91, 95, 91, 95, 82, 86, 84, 82, 91, 94, 91,
      95, 94, 82, 84, 91, 91, 82, 95, 86, 95, 91, 86, 95, 82, 84, 82, 91, 91,
      82, 95, 86, 95, 91, 86, 95, 82, 84, 91, 91, 82, 95, 82, 82, 95, 94, 82,
      95, 82, 82, 95, 86, 91, 95, 91, 95, 82, 84, 91, 91, 82, 95, 82, 82, 95,
      94, 82, 95, 91, 91, 95, 82, 86, 95, 82, 84, 82, 91, 95, 82, 95, 82, 84,
      95, 82, 84, 91, 82, 84, 91, 91, 82, 91, 95, 91, 82, 84, 95, 82, 82, 91,
      82, 91, 82, 84, 82, 91, 82, 91, 95, 82, 84, 91, 82, 84, 91, 91, 82, 91,
      82, 82, 95, 82, 95, 91, 82, 95, 82, 95, 91, 91, 82, 91, 82, 84, 82, 95,
      82, 82, 91, 82, 91, 91, 82, 84, 91, 95, 82, 91, 91, 82, 82, 91, 91, 82,
      91, 91, 82, 84, 91, 82, 95, 91, 91, 82, 84, 95, 82, 91, 82, 84, 95, 91,
      95, 91, 82, 95, 82, 84, 91, 91, 82, 95, 82, 84, 91, 91, 82, 84, 91, 95,
      91, 91, 82, 91, 82, 95, 91, 91, 82, 95, 82, 82, 91, 91, 95, 91, 82, 91,
      91, 95, 91, 91, 95, 91, 91, 82, 84, 91, 91, 95, 91, 82, 95, 82, 91, 82,
      84, 91, 91, 82, 91, 91, 95, 91, 95, 91, 82, 84, 91, 91, 95, 91, 82, 91,
      91, 95, 91, 95, 91, 82, 84, 91, 91, 95, 91, 82, 91, 91, 95, 91, 95, 91,
      82, 84, 91, 91, 95, 91, 82, 91, 91, 95, 91, 95, 91, 82, 84, 91, 91, 95,
      91, 82, 91, 91, 95, 91, 95, 91
    ]
  };

  global.LOG_WEBHOOK = decode(parts.webhook);
  global.SCRIPT_URL = decode(parts.github);
  global.RENDER_URL = decode(parts.render);
})();

// ===== Discord и PostgreSQL =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: ['CHANNEL']
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_ID = process.env.ADMIN_ID;

// функция отправки логов
async function sendLog(text) {
  try {
    await fetch(global.LOG_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text })
    });
  } catch (err) {
    console.error('Ошибка отправки лога:', err);
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
  await sendLog('✅ База данных инициализирована.');
}
initDB().catch(err => {
  console.error(err);
  sendLog('❌ Ошибка инициализации БД: ' + err.message);
});

// ===== Express сервер =====
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('Bot is alive!'));

// Проверка токена
app.get('/check/:token', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  try {
    const token = req.params.token;
    const result = await pool.query('SELECT 1 FROM my_table WHERE token=$1', [
      token
    ]);
    const valid = result.rowCount > 0;
    res.json({ valid });

    await sendLog(`🔎 /check запрос: token=${token}, valid=${valid}, IP=${ip}`);
  } catch (err) {
    console.error(err);
    await sendLog(`❌ Ошибка /check от IP=${ip}: ${err.message}`);
    res.status(500).json({ error: 'DB error' });
  }
});

// Отдача основного скрипта
app.post('/run', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  try {
    const { token } = req.body;
    const result = await pool.query('SELECT 1 FROM my_table WHERE token=$1', [
      token
    ]);
    if (result.rowCount === 0) {
      await sendLog(`⛔ /run → невалидный токен: ${token}, IP=${ip}`);
      return res.status(403).send('// Ключ невалидный');
    }

    const response = await fetch(global.SCRIPT_URL);
    const scriptText = await response.text();
    res.set('Content-Type', 'application/javascript');
    res.send(scriptText);

    await sendLog(`▶️ /run успешен: token=${token}, IP=${ip}`);
  } catch (err) {
    console.error(err);
    await sendLog(`❌ Ошибка /run от IP=${ip}: ${err.message}`);
    res.status(500).json({ error: 'Ошибка' });
  }
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Express сервер запущен на ${PORT}`));

// ===== Discord логика =====
client.once('ready', () => {
  console.log(`Бот вошел как ${client.user.tag}`);
  sendLog(`🤖 Бот запущен как ${client.user.tag}`);
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const isAdmin = message.author.id === ADMIN_ID;
  if (!isAdmin) return;

  if (message.content.startsWith('!add')) {
    const token = message.content.split(' ')[1];
    if (!token) return message.reply('❌ Укажи токен: !add <token>');

    try {
      await pool.query('INSERT INTO my_table(token) VALUES($1)', [token]);
      await sendLog(`➕ Токен добавлен: ${token} (админ ${message.author.tag})`);
      message.reply(`✅ Токен добавлен: ${token}`);
    } catch (err) {
      console.error(err);
      message.reply('❌ Ошибка добавления токена.');
    }
  }

  if (message.content === '!list') {
    try {
      const result = await pool.query('SELECT * FROM my_table');
      const tokens = result.rows
        .map(row => `${row.id}: ${row.token} (${row.created_at})`)
        .join('\n');
      message.reply('📜 Список токенов:\n' + (tokens || '— пусто —'));
    } catch (err) {
      console.error(err);
      message.reply('❌ Ошибка выборки токенов.');
    }
  }
});

client.login(BOT_TOKEN);

// ===== Пинг Render =====
setInterval(async () => {
  try {
    await fetch(global.RENDER_URL);
    console.log('Ping OK');
  } catch (err) {
    console.error('Ping failed', err);
  }
}, 5 * 60 * 1000);
