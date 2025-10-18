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

// === Express ===
const app = express();
app.use(cors());
app.use(express.json());
app.get("/", (req, res) => res.send("Bot is running..."));

// === PostgreSQL ===
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// === Инициализация БД ===
async function initDB() {
  console.log("🧩 Проверка базы данных...");
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS my_table (
        id SERIAL PRIMARY KEY,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Таблица готова");

    // Тест записи
    await pool.query("DELETE FROM my_table WHERE token='__test__';");
    await pool.query("INSERT INTO my_table(token, expires_at) VALUES($1, NOW() + interval '1 minute');", ["__test__"]);
    const check = await pool.query("SELECT * FROM my_table WHERE token='__test__';");
    if (check.rowCount === 1) console.log("✅ Тестовая запись прошла");
    else console.log("⚠️ Не удалось записать в базу, пересоздаю таблицу...");

    await pool.query("DELETE FROM my_table WHERE token='__test__';");
  } catch (e) {
    console.error("❌ Ошибка при инициализации БД:", e.message);
    console.log("🔁 Пересоздаю таблицу...");
    await pool.query("DROP TABLE IF EXISTS my_table;");
    await pool.query(`
      CREATE TABLE my_table (
        id SERIAL PRIMARY KEY,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Таблица пересоздана заново");
  }
}

// === Удаление истёкших токенов ===
async function removeExpiredTokens() {
  const res = await pool.query("DELETE FROM my_table WHERE expires_at <= NOW() RETURNING token");
  for (const row of res.rows) {
    await sendLog("🕒 Удалён просроченный токен", `\`${row.token}\``, "#808080");
  }
}

// === Планировщик ===
function scheduleTokenDeletion(token, expiresAt) {
  const delay = expiresAt.getTime() - Date.now();
  if (delay <= 0) return;
  setTimeout(async () => {
    await pool.query("DELETE FROM my_table WHERE token=$1", [token]);
    await sendLog("🕒 Токен удалён по времени", `Токен: \`${token}\``, "#808080");
  }, delay);
}

// === Логгер ===
async function sendLog(title, description, color = "#2f3136") {
  try {
    await fetch(LOG_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title,
          description,
          color: parseInt(color.replace("#", ""), 16),
          timestamp: new Date().toISOString()
        }]
      })
    });
  } catch (e) {
    console.error("Ошибка логгера:", e.message);
  }
}

// === Команды ===
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

      try {
        await pool.query("INSERT INTO my_table(token, expires_at) VALUES($1, $2)", [token, expiresAt]);
      } catch (err) {
        console.error("Ошибка при добавлении токена:", err.message);
        return message.reply("⚠️ Ошибка при сохранении токена в БД!");
      }

      const verify = await pool.query("SELECT token FROM my_table WHERE token=$1", [token]);
      if (verify.rowCount === 0) {
        return message.reply("❌ Токен не сохранился (ошибка базы)");
      }

      scheduleTokenDeletion(token, expiresAt);

      const expiresString = expiresAt.toLocaleString("ru-RU", { timeZone: "Europe/Kiev" });
      const embed = new EmbedBuilder()
        .setTitle("✅ Токен добавлен")
        .setDescription(`\`${token}\`\nИстекает: **${expiresString}**`)
        .setColor("#2f3136")
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      await sendLog("✅ Добавлен токен", `\`${token}\`\nИстекает ${expiresString}\nДобавил: <@${message.author.id}>`);
    }

    // === !удалить ===
    if (cmd === "!удалить") {
      const token = args[0];
      if (!token) return message.reply("⚙️ Формат: `!удалить <токен>`");
      const res = await pool.query("DELETE FROM my_table WHERE token=$1", [token]);
      const msg = res.rowCount ? `🗑️ \`${token}\` удалён.` : `⚠️ \`${token}\` не найден.`;
      await message.reply(msg);
      await sendLog("🗑️ Удаление токена", msg);
    }

    // === !лист ===
    if (cmd === "!лист") {
      await removeExpiredTokens();
      const res = await pool.query("SELECT token, expires_at FROM my_table ORDER BY id DESC");
      const list = res.rows.length
        ? res.rows.map(r => `• \`${r.token}\`\n  ⏰ ${new Date(r.expires_at).toLocaleString("ru-RU")}`).join("\n\n")
        : "Нет активных токенов.";
      const embed = new EmbedBuilder().setTitle("📋 Список токенов").setDescription(list).setColor("#2f3136");
      await message.reply({ embeds: [embed] });
    }
  } catch (err) {
    console.error("Ошибка команды:", err);
    await message.reply("⚠️ Ошибка при выполнении команды.");
  }
});

// === При запуске ===
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  await sendLog("✅ Бот запущен", new Date().toLocaleString("ru-RU"));
  const res = await pool.query("SELECT token, expires_at FROM my_table");
  for (const row of res.rows) {
    if (row.expires_at) scheduleTokenDeletion(row.token, new Date(row.expires_at));
  }
});

// === Эндпоинт /check ===
app.get("/check/:token", async (req, res) => {
  const token = req.params.token;
  const result = await pool.query("SELECT 1 FROM my_table WHERE token=$1", [token]);
  res.json({ valid: result.rowCount > 0 });
});

// === Самопинг ===
setInterval(() => {
  fetch("https://adadadadad-97sj.onrender.com/check/1").catch(() => {});
}, 5 * 60 * 1000);

// === Запуск ===
await initDB();
app.listen(process.env.PORT || 3000, () => console.log("✅ Server ready"));
client.login(BOT_TOKEN);
