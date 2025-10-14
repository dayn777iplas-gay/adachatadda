// index.js
import { Client, GatewayIntentBits, REST, Routes, EmbedBuilder } from "discord.js";
import { Pool } from "pg";
import express from "express";
import cors from "cors";

const fetch = global.fetch;

// ===== Конфигурация окружения =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_ID = process.env.ADMIN_ID;

// ===== Discord клиент =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ===== Инициализация БД =====
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS my_table (
      id SERIAL PRIMARY KEY,
      token TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log("Database initialized.");
}

// ===== Express сервер =====
const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.send("Bot is running..."));

app.get("/check/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const result = await pool.query("SELECT 1 FROM my_table WHERE token=$1", [token]);
    res.json({ valid: result.rowCount > 0 });
  } catch {
    res.status(500).json({ error: "DB error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ===== Slash-команды =====
const commands = [
  {
    name: "addtoken",
    description: "Добавить новый токен в базу",
    options: [
      {
        name: "token",
        description: "Токен, который нужно добавить",
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "deltoken",
    description: "Удалить токен из базы",
    options: [
      {
        name: "token",
        description: "Токен, который нужно удалить",
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "listtokens",
    description: "Показать все токены в базе",
  },
];

// ===== Регистрация Slash-команд =====
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("Slash-команды зарегистрированы.");
  } catch (err) {
    console.error("Ошибка регистрации команд:", err);
  }
});

// ===== Обработка команд =====
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.user.id !== ADMIN_ID) return; // Игнорировать всех, кроме админа

  const { commandName } = interaction;

  if (commandName === "addtoken") {
    const token = interaction.options.getString("token");
    await pool.query("INSERT INTO my_table(token) VALUES($1)", [token]);

    const embed = new EmbedBuilder()
      .setTitle("✅ Токен добавлен")
      .setDescription(`Токен \`${token}\` успешно добавлен в базу.`)
      .setColor("#2f3136")
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === "deltoken") {
    const token = interaction.options.getString("token");
    const res = await pool.query("DELETE FROM my_table WHERE token=$1", [token]);

    const embed = new EmbedBuilder()
      .setTitle(res.rowCount ? "🗑️ Токен удалён" : "⚠️ Токен не найден")
      .setDescription(
        res.rowCount
          ? `Токен \`${token}\` был удалён из базы.`
          : `Токен \`${token}\` не найден в базе.`
      )
      .setColor("#2f3136")
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === "listtokens") {
    const res = await pool.query("SELECT token FROM my_table ORDER BY id DESC");
    const tokens = res.rows.map((r) => `• ${r.token}`).join("\n") || "Нет активных токенов.";

    const embed = new EmbedBuilder()
      .setTitle("📋 Список токенов")
      .setDescription(tokens)
      .setColor("#2f3136")
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

// ===== Самопинг, чтобы Render не засыпал =====
setInterval(() => {
  fetch(`https://adadadadad-97sj.onrender.com/check/1`).catch(() => {});
}, 5 * 60 * 1000);

// ===== Запуск =====
await initDB();
client.login(BOT_TOKEN);
