import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Partials
} from "discord.js";
import { Pool } from "pg";
import express from "express";
import cors from "cors";

// === Конфигурация ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_ID = process.env.ADMIN_ID;

const LOG_WEBHOOK_URL = "https://discord.com/api/webhooks/1427826300495855697/MtqkHw-X8jm7l8kbIxeVJHvBNcIPufZtxssqd2-wyljCggs9lGi4SMZZivbSckSw7xTU";

if (!BOT_TOKEN || !DATABASE_URL || !ADMIN_ID) {
  console.error("❌ BOT_TOKEN, DATABASE_URL и ADMIN_ID обязательны!");
  process.exit(1);
}

const fetch = global.fetch;

// === Подключение PostgreSQL ===
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// === Discord клиент ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// === Express ===
const app = express();
app.use(cors());
app.use(express.json());
app.get("/", (req, res) => res.send("Bot is running..."));

// === Проверка токена ===
app.get("/check/:token", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  try {
    const token = req.params.token;
    const result = await pool.query("SELECT 1 FROM my_table WHERE token=$1", [token]);
    const valid = result.rowCount > 0;
    res.json({ valid });

    if (token !== "1") {
      await sendLog(
        "🔎 Проверка токена",
        `Токен: \`${token}\`\nIP: ${ip}\nРезультат: **${valid ? "✅ true" : "❌ false"}**`
      );
    }
  } catch (err) {
    console.error("Ошибка проверки токена:", err);
    res.status(500).json({ error: "DB error" });
  }
});

// === Основной JS ===
app.post("/run", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).send("// Токен не указан");
    const result = await pool.query("SELECT 1 FROM my_table WHERE token=$1", [token]);
    const valid = result.rowCount > 0;
    if (!valid) return res.status(403).send("// Ключ невалидный");

    const scriptUrl = "https://bondyuk777.github.io/-/dadwadfafaf.js";
    const response = await fetch(scriptUrl);
    if (!response.ok) return res.status(500).send("// Ошибка загрузки основного скрипта");
    const jsCode = await response.text();
    res.setHeader("Content-Type", "application/javascript");
    res.send(jsCode);
  } catch (err) {
    console.error("Ошибка /run:", err);
    res.status(500).send("// Ошибка сервера");
  }
});

// === Логгер ===
async function sendLog(title, description, color = "#2f3136") {
  try {
    const embed = {
      title,
      description,
      color: parseInt(color.replace("#", ""), 16),
      timestamp: new Date().toISOString()
    };
    await fetch(LOG_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] })
    });
  } catch (err) {
    console.error("Ошибка логгера:", err);
  }
}

// === Инициализация базы ===
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS my_table (
      id SERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log("✅ Таблица проверена");
}

// === Очистка просроченных токенов ===
async function removeExpiredTokens() {
  const now = new Date();
  const res = await pool.query("DELETE FROM my_table WHERE expires_at <= $1 RETURNING token", [now]);
  for (const row of res.rows) {
    await sendLog("🕒 Токен удалён (истёк)", `\`${row.token}\``);
  }
}

// === Планировщик ===
function scheduleTokenDeletion(token, expiresAt) {
  const delay = expiresAt.getTime() - Date.now();
  if (delay <= 0) return;
  setTimeout(async () => {
    await pool.query("DELETE FROM my_table WHERE token=$1", [token]);
    console.log(`🕒 Token ${token} удалён (срок истёк)`);
    await sendLog("🕒 Токен удалён по времени", `\`${token}\``);
  }, delay);
}

// === Команды Discord ===
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.author.id !== ADMIN_ID) return;

  const args = message.content.trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  try {
    // === !выдать ===
   // --- Диагностический блок для !выдать ---
if (cmd === "!выдать") {
  const token = args[0];
  if (!token) return message.reply("⚙️ Формат: `!выдать <токен>`");

  // вычисляем expires (месяц вперёд)
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 1);

  try {
    console.log("=== Диагностика добавления токена ===");
    console.log("Автор команды:", message.author.id);
    console.log("ADMIN_ID:", ADMIN_ID);
    // покажем, к какой базе подключены
    try {
      const info = await pool.query("SELECT current_database() AS db, current_user AS user;");
      console.log("Подключено к базе:", info.rows[0]);
    } catch (infoErr) {
      console.error("Ошибка получения current_database():", infoErr);
    }

    // сам INSERT
    let insertRes;
    try {
      insertRes = await pool.query(
        "INSERT INTO my_table(token, expires_at) VALUES($1,$2) RETURNING id, token, expires_at;",
        [token, expiresAt]
      );
      console.log("INSERT returned:", insertRes.rows);
    } catch (insertErr) {
      console.error("❌ Ошибка INSERT:", insertErr);
      await message.reply("⚠️ Ошибка вставки: " + (insertErr.message || String(insertErr)));
      return;
    }

    // Сразу проверим SELECT — убедимся, что запись действительно в той же БД
    try {
      const sel = await pool.query("SELECT id, token, expires_at FROM my_table WHERE token=$1 LIMIT 1;", [token]);
      console.log("SELECT после INSERT:", sel.rowCount, sel.rows);
      if (sel.rowCount === 0) {
        await message.reply("⚠️ INSERT отработал, но SELECT ничего не нашёл — вероятно, другая БД.");
        return;
      }

      // Успех — покажем данные
      const row = sel.rows[0];
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Токен добавлен (диагностика)")
            .setDescription(`\`${row.token}\`\nID: ${row.id}\nИстекает: ${new Date(row.expires_at).toLocaleString("ru-RU")}`)
            .setColor("#2f3136")
        ]
      });
    } catch (selErr) {
      console.error("Ошибка SELECT после INSERT:", selErr);
      await message.reply("⚠️ Ошибка проверки в базе: " + (selErr.message || String(selErr)));
    }
  } catch (err) {
    console.error("Неожиданная ошибка в !выдать:", err);
    await message.reply("⚠️ Внутренняя ошибка (смотри логи).");
  }
}


    // === !лист ===
    if (cmd === "!лист") {
      await removeExpiredTokens();
      const res = await pool.query("SELECT token, expires_at FROM my_table ORDER BY id DESC");
      const list = res.rows.length
        ? res.rows.map(r => `• \`${r.token}\` — истекает ${new Date(r.expires_at).toLocaleString("ru-RU")}`).join("\n")
        : "Нет активных токенов.";
      const embed = new EmbedBuilder()
        .setTitle("📋 Список токенов")
        .setDescription(list)
        .setColor("#2f3136");
      await message.reply({ embeds: [embed] });
    }

    // === !удалить ===
    if (cmd === "!удалить") {
      const token = args[0];
      if (!token) return message.reply("⚙️ Формат: `!удалить <токен>`");
      const res = await pool.query("DELETE FROM my_table WHERE token=$1", [token]);
      message.reply(res.rowCount ? "🗑️ Токен удалён" : "⚠️ Не найден");
    }

  } catch (err) {
    console.error("Ошибка команды:", err);
    message.reply("⚠️ Ошибка при выполнении команды.");
  }
});

// === Запуск ===
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  await initDB();
  await removeExpiredTokens();
});

// === Самопинг ===
setInterval(() => {
  fetch("https://adadadadad-97sj.onrender.com/check/1").catch(() => {});
}, 5 * 60 * 1000);

app.listen(process.env.PORT || 3000, () => console.log("✅ Server ready"));
client.login(BOT_TOKEN);
