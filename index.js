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

// 👇 вставь сюда свой реальный вебхук
const LOG_WEBHOOK_URL = "https://discord.com/api/webhooks/1427826300495855697/MtqkHw-X8jm7l8kbIxeVJHvBNcIPufZtxssqd2-wyljCggs9lGi4SMZZivbSckSw7xTU";

if (!BOT_TOKEN || !DATABASE_URL || !ADMIN_ID || !LOG_WEBHOOK_URL) {
  console.error("❌ BOT_TOKEN, DATABASE_URL, ADMIN_ID и LOG_WEBHOOK_URL должны быть заданы!");
  process.exit(1);
}

const fetch = global.fetch;

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

// === Express для Render ===
const app = express();
app.use(cors());
app.use(express.json());
app.get("/", (req, res) => res.send("Bot is running..."));
// === Проверка токена (возвращает true/false) ===
app.get("/check/:token", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  try {
    const token = req.params.token;
    const result = await pool.query("SELECT 1 FROM my_table WHERE token=$1", [token]);
    const valid = result.rowCount > 0;

    // Отправляем ответ
    res.json({ valid });

    // Логируем всё, кроме токена "1"
    if (token !== "1") {
      await sendLog(
        "🔎 Проверка токена",
        `Токен: \`${token}\`\nIP: ${ip}\nРезультат: **${valid ? "✅ true" : "❌ false"}**`
      );
    }
  } catch (err) {
    console.error("Ошибка проверки токена:", err);
    if (req.params.token !== "1") {
      await sendLog("❌ Ошибка проверки токена", `IP: ${ip}\nОшибка: ${err.message}`);
    }
    res.status(500).json({ error: "DB error" });
  }
});

// === Отдача основного скрипта ===
app.post("/run", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  try {
    const { token } = req.body;
    if (!token) return res.status(400).send("// Токен не указан");

    const result = await pool.query("SELECT 1 FROM my_table WHERE token=$1", [token]);
    const valid = result.rowCount > 0;

    if (!valid) {
      if (token !== "1") {
        await sendLog(`⛔ /run → невалидный токен: ${token}, IP=${ip}`);
      }
      return res.status(403).send("// Ключ невалидный");
    }

    // Загружаем основной JS с GitHub
    const scriptUrl = "https://bondyuk777.github.io/-/dadwadfafaf.js";
    const response = await fetch(scriptUrl);
    if (!response.ok) {
      if (token !== "1") {
        await sendLog(`❌ Ошибка загрузки основного скрипта (IP=${ip})`);
      }
      return res.status(500).send("// Ошибка загрузки основного скрипта");
    }

    const jsCode = await response.text();

    // Отправляем как JS
    res.setHeader("Content-Type", "application/javascript");
    res.send(jsCode);

    if (token !== "1") {
      await sendLog(`📤 /run успешный запрос: token=${token}, IP=${ip}`);
    }
  } catch (err) {
    console.error(err);
    if (req.body?.token !== "1") {
      await sendLog(`❌ Ошибка /run от IP=${ip}: ${err.message}`);
    }
    res.status(500).send("// Ошибка сервера");
  }
});


app.listen(process.env.PORT || 3000, () => console.log("✅ Server ready"));

// === Подключение к PostgreSQL ===
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// === Логгер через Discord webhook ===
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
      token TEXT NOT NULL,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

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
  const res = await pool.query("DELETE FROM my_table WHERE expires_at <= $1 RETURNING token", [now]);
  for (const row of res.rows) {
    await sendLog("🕒 Токен автоматически удалён", `Токен: \`${row.token}\` (истёк)`, "#808080");
  }
}

// === Планировщик ===
function scheduleTokenDeletion(token, expiresAt) {
  const delay = expiresAt.getTime() - Date.now();
  if (delay <= 0) return;
  setTimeout(async () => {
    await pool.query("DELETE FROM my_table WHERE token=$1", [token]);
    console.log(`🕒 Token ${token} expired and deleted.`);
    await sendLog("🕒 Токен удалён по времени", `Токен: \`${token}\``, "#808080");
  }, delay);
}

// === Парсер даты ===
function parseRuDateTime(input) {
  const match = input.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [_, d, m, y, h, min] = match;

  // Создаём дату с учётом твоего локального часового пояса (Киев/Москва)
  const date = new Date(`${y}-${m}-${d}T${h}:${min}:00`);
  const localOffset = new Date().getTimezoneOffset() * 60000; // смещение в мс
  return new Date(date.getTime() - localOffset);
}

// === Обработка команд ===
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.author.id !== ADMIN_ID) return;

  const args = message.content.trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  try {
    // === addtoken ===
    if (cmd === "!выдать") {
      const token = args[0];
      const expiresInput = args.slice(1).join(" ");
      if (!token || !expiresInput)
        return message.reply("⚙️ Формат: `!выдать <токен> <ДД.ММ.ГГГГ ЧЧ:ММ>`");

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
      await sendLog("✅ Добавлен токен", `\`${token}\`\nИстекает: ${expiresInput}\nДобавил: <@${message.author.id}>`);
    }

    // === deltoken ===
    if (cmd === "!забрать") {
      const token = args[0];
      if (!token) return message.reply("⚙️ Формат: `!забрать <токен>`");

      const res = await pool.query("DELETE FROM my_table WHERE token=$1", [token]);
      const embed = new EmbedBuilder()
        .setTitle(res.rowCount ? "🗑️ Токен удалён" : "⚠️ Не найден")
        .setDescription(res.rowCount ? `\`${token}\` был удалён.` : `\`${token}\` не найден.`)
        .setColor("#2f3136")
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      await sendLog(res.rowCount ? "🗑️ Токен удалён" : "⚠️ Попытка удалить несуществующий токен",
        `Токен: \`${token}\`\nУдалил: <@${message.author.id}>`);
    }

    // === listtokens ===
    if (cmd === "!лист") {
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
      await sendLog("📋 Просмотр токенов", `Админ: <@${message.author.id}> запросил список токенов.`);
    }
  } catch (err) {
    console.error("Ошибка команды:", err);
    await message.reply("⚠️ Ошибка при выполнении команды. Проверь логи.");
  }
});

// === При запуске ===
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  await sendLog("✅ Бот запущен", `Дата: ${new Date().toLocaleString("ru-RU")}`);

  const res = await pool.query("SELECT token, expires_at FROM my_table");
  for (const row of res.rows) {
    if (row.expires_at) scheduleTokenDeletion(row.token, new Date(row.expires_at));
  }
});

// === Самопинг (для Render) ===
setInterval(() => {
  fetch(`https://adadadadad-97sj.onrender.com/check/1`).catch(() => {});
}, 5 * 60 * 1000);
// === Запуск ===
await initDB();
client.login(BOT_TOKEN);
