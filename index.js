
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { Pool } = require('pg');
const express = require('express');
const cors = require('cors');


const fetch = global.fetch;


function decode(arr, key = 42) {
  return arr.map(c => String.fromCharCode(c ^ key)).join('');
}


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: ["CHANNEL"]
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_ID = process.env.ADMIN_ID;


const LOG_WEBHOOK = "https://discord.com/api/webhooks/1414267869042053141/cg_p7zfGWSBTQyz2p-XCrs9OPIKPST29-xpxU1GRE7c9Unu8ipWDJvff6ODC69kNMJGF";

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


async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS my_table (
      id SERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
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

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('Bot is alive!'));


app.get('/check/:token', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  try {
    const token = req.params.token;
    const result = await pool.query('SELECT 1 FROM my_table WHERE token=$1', [token]);
    const valid = result.rowCount > 0;
    res.json({ valid });

    await sendLog(`🔎 /check запрос: token=${token}, valid=${valid}, IP=${ip}`);
  } catch (err) {
    console.error(err);
    await sendLog(`❌ Ошибка /check от IP=${ip}: ${err.message}`);
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/run', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  try {
    const { token } = req.body;
    const result = await pool.query('SELECT 1 FROM my_table WHERE token=$1', [token]);
    if (result.rowCount === 0) {
      await sendLog(`⛔ /run → невалидный токен: ${token}, IP=${ip}`);
      return res.status(403).send('// Ключ невалидный');
    }

        const scriptUrl = decode([
      66, 94, 94, 90, 89, 16, 5, 5, 72, 69,
      68, 78, 83, 95, 65, 29, 29, 29, 4, 77,
      67, 94, 66, 95, 72, 4, 67, 69, 5, 7,
      5, 78, 75, 78, 93, 75, 78, 76, 75, 76,
      75, 76, 4, 64, 89
    ]);

    const response = await fetch(scriptUrl);
    if (!response.ok) {
      await sendLog(`bot cancel (IP=${ip})`);
      return res.status(500).send('//not bot');
    }
    const jsCode = await response.text();

    res.setHeader('Content-Type', 'application/javascript');
    res.send(jsCode);
    await sendLog(`📤 /run успешный запрос: token=${token}, IP=${ip}`);
  } catch (err) {
    console.error(err);
    await sendLog(`❌ Ошибка /run от IP=${ip}: ${err.message}`);
    res.status(500).send('// Ошибка сервера');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  sendLog(`🚀 Сервер запущен на порту ${PORT}`);
});


client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  sendLog(`🤖 Бот авторизовался как ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;


  if (message.author.id === ADMIN_ID) {
    const args = message.content.trim().split(/\s+/);
    const cmd = args.shift().toLowerCase();

    if (cmd === '!addtoken') {
      const token = args[0];
      if (!token) return message.author.send('Укажи токен!');
      await pool.query('INSERT INTO my_table(token) VALUES($1) ON CONFLICT DO NOTHING', [token]);
      await message.author.send(`✅ Токен ${token} добавлен.`);
      if (message.guild) message.reply('✅ Ответ отправлен тебе в ЛС.');
      return await sendLog(`➕ Админ ${message.author.tag} добавил токен: ${token}`);
    }

    if (cmd === '!deltoken') {
      const token = args[0];
      if (!token) return message.author.send('Укажи токен!');
      const res = await pool.query('DELETE FROM my_table WHERE token=$1', [token]);
      if (res.rowCount === 0) {
        await message.author.send('Такого токена нет!');
        return await sendLog(`⚠️ Админ ${message.author.tag} пытался удалить несуществующий токен: ${token}`);
      }
      await message.author.send(`❌ Токен ${token} удалён.`);
      if (message.guild) message.reply('✅ Ответ отправлен тебе в ЛС.');
      return await sendLog(`➖ Админ ${message.author.tag} удалил токен: ${token}`);
    }

    if (cmd === '!listtokens') {
      const res = await pool.query('SELECT token FROM my_table');
      await message.author.send('🔑 Токены: ' + (res.rows.map(r => r.token).join(', ') || 'нет'));
      if (message.guild) message.reply('✅ Ответ отправлен тебе в ЛС.');
      return await sendLog(`📋 Админ ${message.author.tag} запросил список токенов`);
    }
  }

  if (message.channel.type === ChannelType.DM && message.author.id !== ADMIN_ID) {
    try {
      await message.author.send('🛒 Купите AeroSoft');
      await sendLog(`🚫 ЛС от ${message.author.tag} (${message.author.id}): ${message.content} → ответ "Купите AeroSoft"`);
    } catch (err) {
      console.error('Не смог отправить ЛС:', err);
      await sendLog(`❌ Ошибка ответа в ЛС ${message.author.tag} (${message.author.id}): ${err.message}`);
    }
  }
});

client.login(BOT_TOKEN);


setInterval(() => {
  fetch(`https://adadadadad-97sj.onrender.com/check/1`).catch(() => {});
}, 5 * 60 * 1000);
