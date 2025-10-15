// index.js
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  EmbedBuilder
} from "discord.js";
import { Pool } from "pg";
import express from "express";
import cors from "cors";

const fetch = global.fetch;

// === Конфигурация ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_ID = process.env.ADMIN_ID;

// === Discord клиент ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: ["CHANNEL"]
});

// === PostgreSQL ===
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// === Express сервер ===
const app = express();
app.use(cors());
app.use(express.json());
app.get("/", (req, res) => res.send("Bot is running..."));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// === Инициализация базы ===
async function initDB() {
  // создаём таблицу, если нет
  await pool.query(`
    CREATE TABLE IF NOT EXISTS my_table (
      id SERIAL PRIMARY KEY,
      token TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 🔧 автоматически добавляем недостающие поля
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

  console.log("Database initialized.");
  await removeExpiredTokens();
}

// === Удаление просроченных токенов ===
async function removeExpiredTokens() {
  const now = new Date();
  await pool.query("DELETE FROM my_table WHERE expires_at <= $1", [now]);
}

// === Планировщик удаления ===
async function scheduleTokenDeletion(token, expiresAt) {
  const delay = expiresAt.getTime() - Date.now();
  if (delay <= 0) return;
  setTimeout(async () => {
    await pool.query("DELETE FROM my_table WHERE token=$1", [token]);
    console.log(`Token ${token} expired and deleted.`);
  }, delay);
}

// === Slash-команды ===
const commands = [
  {
    name: "addtoken",
    description: "Добавить новый токен",
    options: [
      {
        name: "token",
        description: "Токен, который нужно добавить",
        type: 3,
        required: true
      },
      {
        name: "expires",
        description: "Когда истекает токен (например: 16.10.2025 23:30)",
        type: 3,
        required: true
      }
    ]
  },
  {
    name: "deltoken",
    description: "Удалить токен",
    options: [
      {
        name: "token",
        description: "Токен, который нужно удалить",
        type: 3,
        required: true
      }
    ]
  },
  { name: "listtokens", description: "Показать все активные токены" }
];

// === Регистрация Slash-команд ===
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("Slash-команды зарегистрированы.");
  } catch (err) {
    console.error("Ошибка регистрации команд:", err);
  }

  const res = await pool.query("SELECT token, expires_at FROM my_table");
  for (const row of res.rows) {
    if (row.expires_at) scheduleTokenDeletion(row.token, new Date(row.expires_at));
  }
});

// === Обработка Slash-команд ===
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.user.id !== ADMIN_ID) return;

  const { commandName } = interaction;

  if (commandName === "addtoken") {
    const token = interaction.options.getString("token");
    const expiresInput = interaction.options.getString("expires");
    const match = expiresInput.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
    if (!match)
      return interaction.reply({
        content: "⚠️ Формат: `ДД.ММ.ГГГГ ЧЧ:ММ` (например `16.10.2025 23:30`).",
        ephemeral: true
      });

    const [_, d, m, y, h, min] = match;
    const expiresAt = new Date(`${y}-${m}-${d}T${h}:${min}:00`);
    await pool.query("INSERT INTO my_table(token, expires_at) VALUES($1,$2)", [token, expiresAt]);
    scheduleTokenDeletion(token, expiresAt);

    const embed = new EmbedBuilder()
      .setTitle("✅ Токен добавлен")
      .setDescription(`Токен \`${token}\` добавлен.\nИстекает: **${expiresInput}**`)
      .setColor("#2f3136")
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === "deltoken") {
    const token = interaction.options.getString("token");
    const res = await pool.query("DELETE FROM my_table WHERE token=$1", [token]);
    const embed = new EmbedBuilder()
      .setTitle(res.rowCount ? "🗑️ Токен удалён" : "⚠️ Токен не найден")
      .setDescription(res.rowCount ? `Токен \`${token}\` был удалён.` : `Токен \`${token}\` не найден.`)
      .setColor("#2f3136")
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === "listtokens") {
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
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

// === DM-команды для администратора ===
client.on("messageCreate", async (message) => {
  if (message.author.bot || message.author.id !== ADMIN_ID || message.channel.type !== 1) return;

  const args = message.content.trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  if (cmd === "addtoken") {
    const token = args[0];
    const expiresInput = args.slice(1).join(" ");
    if (!token || !expiresInput)
      return message.reply("❗ Формат: `addtoken <токен> <ДД.ММ.ГГГГ ЧЧ:ММ>`");

    const match = expiresInput.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
    if (!match) return message.reply("⚠️ Формат: `ДД.ММ.ГГГГ ЧЧ:ММ`.");
    const [_, d, m, y, h, min] = match;
    const expiresAt = new Date(`${y}-${m}-${d}T${h}:${min}:00`);
    await pool.query("INSERT INTO my_table(token, expires_at) VALUES($1,$2)", [token, expiresAt]);
    scheduleTokenDeletion(token, expiresAt);

    const embed = new EmbedBuilder()
      .setTitle("✅ Токен добавлен")
      .setDescription(`Токен \`${token}\` добавлен.\nИстекает: **${expiresInput}**`)
      .setColor("#2f3136")
      .setTimestamp();
    await message.reply({ embeds: [embed] });
  }

  if (cmd === "deltoken") {
    const token = args[0];
    if (!token) return message.reply("❗ Формат: `deltoken <токен>`");
    const res = await pool.query("DELETE FROM my_table WHERE token=$1", [token]);
    const embed = new EmbedBuilder()
      .setTitle(res.rowCount ? "🗑️ Токен удалён" : "⚠️ Токен не найден")
      .setDescription(res.rowCount ? `Токен \`${token}\` был удалён.` : `Токен \`${token}\` не найден.`)
      .setColor("#2f3136")
      .setTimestamp();
    await message.reply({ embeds: [embed] });
  }

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
});

// === Самопинг (для Render) ===
setInterval(() => {
  fetch(`https://adadadadad-97sj.onrender.com/check/1`).catch(() => {});
}, 5 * 60 * 1000);

// === Запуск ===
await initDB();
client.login(BOT_TOKEN);
