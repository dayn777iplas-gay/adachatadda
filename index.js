import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Partials
} from "discord.js";
import { Pool } from "pg";
import express from "express";
import cors from "cors";

const fetch = global.fetch;

// === Конфигурация ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_ID = process.env.ADMIN_ID;
const BASE_URL = process.env.BASE_URL || "https://your-app-name.onrender.com";

if (!BOT_TOKEN || !DATABASE_URL || !ADMIN_ID) {
  console.error("❌ BOT_TOKEN, DATABASE_URL и ADMIN_ID должны быть заданы в .env");
  process.exit(1);
}

// === Клиент Discord ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// === Express сервер (чтобы Render не засыпал) ===
const app = express();
app.use(cors());
app.get("/", (req, res) => res.send("Bot is running..."));
app.listen(process.env.PORT || 3000, () => console.log("✅ Server ready"));

// === Подключение к PostgreSQL ===
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// === Инициализация БД ===
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS my_table (
      id SERIAL PRIMARY KEY,
      token TEXT NOT NULL,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Добавляем колонки, если отсутствуют
  await pool.query(`
    DO $$
    BEGIN
      BEGIN
        ALTER TABLE my_table ADD COLUMN expires_at TIMESTAMP;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END;
      BEGIN
        ALTER TABLE my_table ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END;
    END$$;
  `);

  console.log("✅ Database initialized.");
  await removeExpiredTokens();
}

// === Удаление просроченных токенов ===
async function removeExpiredTokens() {
  const now = new Date();
  await pool.query("DELETE FROM my_table WHERE expires_at <= $1", [now]);
}

// === Автоматическое удаление по времени ===
function scheduleTokenDeletion(token, expiresAt) {
  const delay = expiresAt.getTime() - Date.now();
  if (delay <= 0) return;
  setTimeout(async () => {
    await pool.query("DELETE FROM my_table WHERE token=$1", [token]);
    console.log(`🕒 Token ${token} expired and deleted.`);
  }, delay);
}

// === Парсинг даты ===
function parseRuDateTime(input) {
  const match = input.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [_, d, m, y, h, min] = match;
  const date = new Date(`${y}-${m}-${d}T${h}:${min}:00`);
  return isNaN(date) ? null : date;
}

// === Обработка текстовых команд ===
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.author.id !== ADMIN_ID) return; // Только админ
  if (!message.content.startsWith("addtoken") &&
      !message.content.startsWith("deltoken") &&
      !message.content.startsWith("listtokens")) return;

  const args = message.content.trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  try {
    // === addtoken ===
    if (cmd === "addtoken") {
      const token = args[0];
      const expiresInput = args.slice(1).join(" ");
      if (!token || !expiresInput)
        return message.reply("⚙️ Формат: `addtoken <токен> <ДД.ММ.ГГГГ ЧЧ:ММ>`");

      const expiresAt = parseRuDateTime(expiresInput);
      if (!expiresAt)
        return message.reply("⚠️ Неверный формат даты. Пример: `16.10.2025 23:30`");

      await pool.query("INSERT INTO my_table(token, expires_at) VALUES($1,$2)", [token, expiresAt]);
      scheduleTokenDeletion(token, expiresAt);

      const embed = new EmbedBuilder()
        .setTitle("✅ Токен добавлен")
        .setDescription(`\`${token}\`\nИстекает: **${expiresInput}**`)
        .setColor("#2f3136")
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    }

    // === deltoken ===
    if (cmd === "deltoken") {
      const token = args[0];
      if (!token) return message.reply("⚙️ Формат: `deltoken <токен>`");

      const res = await pool.query("DELETE FROM my_table WHERE token=$1", [token]);
      const embed = new EmbedBuilder()
        .setTitle(res.rowCount ? "🗑️ Токен удалён" : "⚠️ Не найден")
        .setDescription(res.rowCount ? `\`${token}\` был удалён.` : `\`${token}\` не найден.`)
        .setColor("#2f3136")
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    }

    // === listtokens ===
    if (cmd === "listtokens") {
      await removeExpiredTokens();
      const res = await pool.query("SELECT token, expires_at FROM my_table ORDER BY id DESC");
      const list = res.rows.length
        ? res.rows.map(r => `• \`${r.token}\`\n  ⏰ Истекает: ${r.expires_at ? new Date(r.expires_at).toLocaleString("ru-RU") : "—"}`).join("\n\n")
        : "Нет активных токенов.";

      const embed = new EmbedBuilder()
        .setTitle("📋 Список токенов")
        .setDescription(list)
        .setColor("#2f3136")
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    }
  } catch (err) {
    console.error("Ошибка команды:", err);
    await message.reply("⚠️ Ошибка при выполнении команды. Проверь логи.");
  }
});

// === При запуске ===
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  // Восстанавливаем активные токены
  const res = await pool.query("SELECT token, expires_at FROM my_table");
  for (const row of res.rows) {
    if (row.expires_at) scheduleTokenDeletion(row.token, new Date(row.expires_at));
  }
});

// === Самопинг Render ===
setInterval(() => {
  fetch("https://adadadadad-97sj.onrender.com/check/1").catch(() => {});
}, 5 * 60 * 1000);

// === Запуск ===
await initDB();
client.login(BOT_TOKEN);

