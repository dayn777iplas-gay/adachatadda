const { Client, GatewayIntentBits } = require('discord.js');
const { Pool } = require('pg');
const express = require('express');

// ===== Express сервер для Render =====
const app = express();
app.get('/', (req, res) => res.send('Bot is alive!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ===== Discord бот =====
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// Переменные окружения
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_ID = process.env.ADMIN_ID;

// ===== PostgreSQL =====
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Нужно для Render
});

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

// ===== События бота =====
client.on('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Только админ может использовать команды
  if (message.author.id !== ADMIN_ID) {
    message.reply('Ты не админ!');
    return;
  }

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
