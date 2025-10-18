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

// === Express сервер для Render ===
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

// === Отдача основного скрипта ===
app.post("/run", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  try {
    const { token } = req.body;
    if (!token) return res.status(400).send("// Токен не указан");

    const result = await pool.query("SELECT 1 FROM my_table WHERE token=$1", [token]);
    const valid = result.rowCount > 0;
    if (!valid) {
      if (token !== "1") await sendLog(`⛔ /run → невалидный токен: ${token}, IP=${ip}`);
      return res.status(403).send("// Ключ невалидный");
    }

    const scriptUrl = "https://bondyuk777.github.io/-/dadwadfafaf.js";
    const response = await fetch(scriptUrl);
    if (!response.ok) {
      if (token !== "1") await sendLog(`❌ Ошибка загрузки основного скрипта (IP=${ip})`);
      return res.status(500).send("// Ошибка загрузки основного скрипта");
    }

    const jsCode = await response.text();
    res.setHeader("Content-Type", "application/javascript");
    res.send(jsCode);

    if (token !== "1") await sendLog(`📤 /run успешный запрос: token=${token}, IP=${ip}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("// Ошибка сервера");
  }
});

app.listen(process.env.PORT || 3000, () => console.log("✅ Server ready"));

// === Подключение PostgreSQL ===
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
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
  console.log("🧩 Проверка базы данных...");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS my_table (
      id SERIAL PRIMARY KEY,
      token TEXT NOT NULL,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const { rows } = await pool.query(`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'my_table';
  `);
  const existing = rows.map(r => r.column_name);

  if (!existing.includes("expires_at")) {
    await pool.query(`ALTER TABLE my_table ADD COLUMN expires_at TIMESTAMP;`);
    console.log("🛠️ Добавлена колонка expires_at");
  }
  if (!existing.includes("created_at")) {
    await pool.query(`ALTER TABLE my_table ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
    console.log("🛠️ Добавлена колонка created_at");
  }

  console.log("✅ Database initialized and verified.");
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

// === Планировщик удаления ===
function scheduleTokenDeletion(token, expiresAt) {
  const delay = expiresAt.getTime() - Date.now();
  if (delay <= 0) return;
  setTimeout(async () => {
    await pool.query("DELETE FROM my_table WHERE token=$1", [token]);
    console.log(`🕒 Token ${token} expired and deleted.`);
    await sendLog("🕒 Токен удалён по времени", `Токен: \`${token}\``, "#808080");
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
    if (cmd === "!выдать") {
      const token = args[0];
      if (!token) return message.reply("⚙️ Формат: `!выдать <токен>` (срок автоматически 1 месяц)");

      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1);

      await pool.query("INSERT INTO my_table(token, expires_at) VALUES($1,$2)", [token, expiresAt]);
      console.log(`💾 Токен ${token} сохранён в базу до ${expiresAt}`);

      const verify = await pool.query("SELECT 1 FROM my_table WHERE token=$1", [token]);
      if (verify.rowCount === 0) {
        return message.reply("⚠️ Ошибка: токен не сохранился в БД!");
      }

      scheduleTokenDeletion(token, expiresAt);

      const expiresString = expiresAt.toLocaleString("ru-RU", { timeZone: "Europe/Kiev" });
      const embed = new EmbedBuilder()
        .setTitle("✅ Токен добавлен")
        .setDescription(`\`${token}\`\nИстекает: **${expiresString}**`)
        .setColor("#2f3136")
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      await sendLog("✅ Добавлен токен", `\`${token}\`\nИстекает через 1 месяц — ${expiresString}\nДобавил: <@${message.author.id}>`);
    }

    // === !удалить ===
    if (cmd === "!удалить") {
      const token = args[0];
      if (!token) return message.reply("⚙️ Формат: `!удалить <токен>`");

      const res = await pool.query("DELETE FROM my_table WHERE token=$1", [token]);
      const embed = new EmbedBuilder()
        .setTitle(res.rowCount ? "🗑️ Токен удалён" : "⚠️ Не найден")
        .setDescription(res.rowCount ? `\`${token}\` был удалён.` : `\`${token}\` не найден.`)
        .setColor("#2f3136")
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      await sendLog(res.rowCount ? "🗑️ Токен удалён" : "⚠️ Попытка удалить несуществующий токен", `Токен: \`${token}\`\nУдалил: <@${message.author.id}>`);
    }

    // === !лист ===
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

// === Самопинг ===
setInterval(() => {
  fetch("https://adadadadad-97sj.onrender.com/check/1").catch(() => {});
}, 5 * 60 * 1000);

// === Запуск ===
await initDB();
client.login(BOT_TOKEN);
