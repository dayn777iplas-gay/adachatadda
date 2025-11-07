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
  // Токены (доступы)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS my_table (
      id SERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Выигранные промокоды
  await pool.query(`
    CREATE TABLE IF NOT EXISTS promos (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      discount INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Кулдаун попыток (фиксируем факт крутки, даже если не выпало)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS promo_cooldowns (
      user_id TEXT PRIMARY KEY,
      last_spin_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("✅ Таблицы проверены");
}

// === Очистка просроченных токенов ===
async function removeExpiredTokens() {
  const now = new Date();
  const res = await pool.query("DELETE FROM my_table WHERE expires_at <= $1 RETURNING token", [now]);
  for (const row of res.rows) {
    await sendLog("🕒 Токен удалён (истёк)", `\`${row.token}\``);
  }
}

// === Планировщик (опционально) ===
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

  const args = message.content.trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  try {
    // === !промо (для всех) — кулдаун через promo_cooldowns
    if (cmd === "!промо") {
      const userId = message.author.id;

      // 1) Атомарный гейт раз в 24 часа
      const gate = await pool.query(
        `
        INSERT INTO promo_cooldowns (user_id, last_spin_at)
        VALUES ($1, NOW())
        ON CONFLICT (user_id) DO UPDATE
          SET last_spin_at = EXCLUDED.last_spin_at
        WHERE promo_cooldowns.last_spin_at <= NOW() - INTERVAL '24 hours'
        RETURNING last_spin_at;
        `,
        [userId]
      );

      if (gate.rowCount === 0) {
        // Кулдаун не истёк
        const last = await pool.query(
          `SELECT last_spin_at FROM promo_cooldowns WHERE user_id=$1`,
          [userId]
        );
        const lastTime = new Date(last.rows[0].last_spin_at).getTime();
        const ms24h = 24 * 60 * 60 * 1000;
        const remainMs = Math.max(0, ms24h - (Date.now() - lastTime));
        const remainHours = (remainMs / (1000 * 60 * 60)).toFixed(1);

        await message.reply(`⏰ Ты уже крутил колесо недавно! Попробуй снова через **${remainHours} ч.**`);
        return;
      }

      // 2) Анимация «крутится»
      const spinningMsg = await message.reply("🎡 Колесо крутится...");
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      for (const text of ["🎡 Колесо крутится...", "🎯 Почти...", "✨ Остановилось!"]) {
        await wait(1000);
        await spinningMsg.edit(text);
      }

      // 3) Результат
      const chance = Math.random();
      if (chance > 0.10) {
        await wait(500);
        await spinningMsg.edit("😢 Увы, в этот раз без промокода. Попробуй завтра!");
        return;
      }

      const discount = Math.floor(Math.random() * (60 - 5 + 1)) + 5;
      await pool.query("INSERT INTO promos (user_id, discount) VALUES ($1, $2)", [userId, discount]);

      await wait(500);
      await spinningMsg.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle("🎉 Поздравляем!")
            .setDescription(`Ты выиграл промокод на **${discount}%** скидку!\n\nКрутить снова можно через 24 часа.`)
            .setColor("#00ff88")
        ]
      });

      await sendLog("🎁 Новый промокод", `Пользователь: <@${userId}>\nСкидка: **${discount}%**`);
      return;
    }

    // === !профиль (уникальный дизайн)
    if (cmd === "!профиль") {
      const userId = message.author.id;

      // В этой модели в promos только выигрыши и ручные выдачи
      const res = await pool.query(
        "SELECT id, discount, created_at FROM promos WHERE user_id=$1 ORDER BY id ASC",
        [userId]
      );
      const hasPromo = res.rowCount > 0;

      // ⚠️ Зависит от того, что реально хранится в my_table
      const tokenCheck = await pool.query("SELECT 1 FROM my_table WHERE token=$1", [userId]);
      const hasCheat = tokenCheck.rowCount > 0;

      const promoList = hasPromo
        ? res.rows
            .map(
              (r) =>
                `🔹 **#${r.id}** — ${r.discount}% (выдан ${new Date(
                  r.created_at
                ).toLocaleDateString("ru-RU")})`
            )
            .join("\n")
        : "Промокоды пока отсутствуют 😔";

      const embed = new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("🌟 Профиль пользователя")
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
        .setDescription(
          `**👤 Пользователь:** ${message.author.username}\n` +
          `**💼 Наличие чита:** ${hasCheat ? "✅ Есть доступ" : "❌ Нет доступа"}`
        )
        .addFields(
          {
            name: "🎟 Активные промокоды",
            value: promoList,
            inline: false
          },
          {
            name: "ℹ️ Возможности:",
            value:
              "🎁 Передай промокод другу — `!передать <ID>`\n" +
              "🛒 Используй промокод при покупке — `!купить`\n" +
              "📅 Новые шансы получить промо — через `!промо`",
            inline: false
          }
        )
        .setFooter({
          text: "Система лояльности | Активен ежедневно",
          iconURL: "https://cdn-icons-png.flaticon.com/512/854/854878.png"
        })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      return;
    }

    // === !передать (передача промокода другому пользователю)
    if (cmd === "!передать") {
      const targetUser = message.mentions.users.first();
      const promoId = parseInt(args[1], 10);

      if (!targetUser || !promoId) {
        return message.reply("⚙️ Формат: `!передать @пользователь <ID промокода>`");
      }

      if (targetUser.id === message.author.id) {
        return message.reply("😅 Нельзя передавать промокод самому себе.");
      }

      const promo = await pool.query(
        "SELECT id, discount FROM promos WHERE id=$1 AND user_id=$2",
        [promoId, message.author.id]
      );

      if (promo.rowCount === 0) {
        return message.reply("⚠️ У тебя нет промокода с таким ID.");
      }

      await pool.query("UPDATE promos SET user_id=$1 WHERE id=$2", [targetUser.id, promoId]);

      await message.reply(
        `🎁 Промокод **#${promoId} (${promo.rows[0].discount}% скидки)** успешно передан пользователю <@${targetUser.id}>!`
      );

      try {
        await targetUser.send(
          `🎉 Тебе передали промокод **#${promoId} (${promo.rows[0].discount}% скидки)** от пользователя ${message.author.username}!`
        );
      } catch {
        await message.reply("⚠️ Получателю не удалось отправить личное сообщение (возможно, закрыт ЛС).");
      }

      await sendLog(
        "🔄 Передача промокода",
        `От: <@${message.author.id}>\nКому: <@${targetUser.id}>\nID промокода: **${promoId}** (${promo.rows[0].discount}%)`
      );

      return;
    }

    // === Ниже — только для ADMIN_ID ===
    if (message.author.id !== ADMIN_ID) return;

    // === !выдатьпромо @user <скидка>
    if (cmd === "!выдатьпромо") {
      // Поддержка: !выдатьпромо @mention 25  ИЛИ  !выдатьпромо 123456789012345678 25
      let target = message.mentions.users.first() || null;
      let discountArgIndex = 1;

      if (!target && args[0]) {
        // пробуем как userId
        try {
          target = await client.users.fetch(args[0]);
          discountArgIndex = 1;
        } catch {
          // если первый аргумент не id, значит возможно формат "!выдатьпромо 25" (нет пользователя)
        }
      }

      const discount = parseInt(args[discountArgIndex], 10);

      if (!target || !Number.isInteger(discount) || discount < 1 || discount > 100) {
        return message.reply("⚙️ Формат: `!выдатьпромо @пользователь <1..100>` (например, `!выдатьпромо @User 25`)");
      }

      await pool.query(
        "INSERT INTO promos (user_id, discount) VALUES ($1, $2)",
        [target.id, discount]
      );

      // Сообщение в канал
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Промокод выдан")
            .setDescription(`Получатель: <@${target.id}>\nСкидка: **${discount}%**`)
            .setColor("#00c853")
        ]
      });

      // Пытаемся уведомить получателя в ЛС
      try {
        await target.send(`🎁 Администратор выдал тебе промокод со скидкой **${discount}%**!`);
      } catch {
        // молча игнорируем, если ЛС закрыт
      }

      await sendLog(
        "🏷️ Выдача промокода (админ)",
        `Админ: <@${message.author.id}>\nКому: <@${target.id}>\nСкидка: **${discount}%**`
      );

      return;
    }

    // === !выдать (токен доступа)
    if (cmd === "!выдать") {
      const token = args[0];
      if (!token) return message.reply("⚙️ Формат: `!выдать <токен>`");

      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1);

      try {
        const insertRes = await pool.query(
          "INSERT INTO my_table(token, expires_at) VALUES($1,$2) RETURNING id, token, expires_at;",
          [token, expiresAt]
        );

        const row = insertRes.rows[0];
        await message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("✅ Токен добавлен")
              .setDescription(`\`${row.token}\`\nID: ${row.id}\nИстекает: ${new Date(row.expires_at).toLocaleString("ru-RU")}`)
              .setColor("#2f3136")
          ]
        });
      } catch (err) {
        console.error("Ошибка INSERT:", err);
        await message.reply("⚠️ Ошибка при добавлении токена: " + err.message);
      }
      return;
    }

    // === !лист (токены)
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
      return;
    }

    // === !удалить (токен)
    if (cmd === "!удалить") {
      const token = args[0];
      if (!token) return message.reply("⚙️ Формат: `!удалить <токен>`");
      const res = await pool.query("DELETE FROM my_table WHERE token=$1", [token]);
      await message.reply(res.rowCount ? "🗑️ Токен удалён" : "⚠️ Не найден");
      return;
    }

  } catch (err) {
    console.error("Ошибка команды:", err);
    await message.reply("⚠️ Ошибка при выполнении команды.");
  }
});

// === Запуск ===
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  await initDB();
  await removeExpiredTokens();
});

// === Самопинг (Render keep-alive) ===
setInterval(() => {
  fetch("https://adadadadad-97sj.onrender.com/check/1").catch(() => {});
}, 5 * 60 * 1000);

app.listen(process.env.PORT || 3000, () => console.log("✅ Server ready"));
client.login(BOT_TOKEN);
