import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
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

  // Выигранные/выданные промокоды
  await pool.query(`
    CREATE TABLE IF NOT EXISTS promos (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      discount INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Кулдаун попыток
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

// === Вспомогательные ===
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// построить 3x4 «колесо» кнопками; activeIndex подсвечиваем
function buildWheelComponents(segments, activeIndex) {
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 4; c++) {
      const i = r * 4 + c;
      const label = segments[i];
      // Базовый стиль: проценты зелёные, пустые серые
      let style = label === "—" ? ButtonStyle.Secondary : ButtonStyle.Success;
      // Активный сектор выделяем синим
      if (i === activeIndex) style = ButtonStyle.Primary;

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`spin_${i}`) // клики не обрабатываем, всё отключено
          .setLabel(label)
          .setStyle(style)
          .setDisabled(true)
      );
    }
    rows.push(row);
  }
  return rows;
}

// === Команды Discord ===
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  try {
    // === !промо — с визуальной рулеткой ===
    if (cmd === "!промо") {
      const userId = message.author.id;

      // 1) Кулдаун 24ч (атомарный UPSERT-гейт)
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

      // 2) Настройка рулетки
      // 12 секторов: «—» = нет выигрыша; проценты = приз
      const segments = ["—", "5%", "—", "10%", "—", "15%", "—", "20%", "—", "30%", "—", "60%"];

      // шанс выигрыша 10%
      const isWin = Math.random() < 0.10;
      const prizeList = [5, 10, 15, 20, 30, 60];
      const targetLabel = isWin ? `${prizeList[Math.floor(Math.random() * prizeList.length)]}%` : "—";

      // выбираем финальный сектор с таким лейблом
      const candidateIdx = segments
        .map((v, i) => (v === targetLabel ? i : -1))
        .filter((i) => i !== -1);
      const finalIndex = candidateIdx[Math.floor(Math.random() * candidateIdx.length)];

      // стартовый сектор и общее кол-во шагов со смещением на финал
      let currentIndex = Math.floor(Math.random() * segments.length);
      const spins = 2 + Math.floor(Math.random() * 3); // 2..4 полных оборота
      const stepsToFinal =
        spins * segments.length + ((finalIndex - currentIndex + segments.length) % segments.length);

      // 3) Отправляем «колесо» и вращаем с замедлением
      let wheelMsg = await message.reply({
        content: "🎡 Запускаю рулетку...",
        components: buildWheelComponents(segments, currentIndex)
      });

      for (let step = 0; step < stepsToFinal; step++) {
        currentIndex = (currentIndex + 1) % segments.length;

        // easing: от 80мс до 420мс с квадратичным замедлением
        const t = (step + 1) / stepsToFinal;
        const delay = Math.round(80 + (420 - 80) * (t * t));

        await sleep(delay);
        await wheelMsg.edit({
          content: t < 0.85 ? "🎡 Крутится..." : "🎯 Почти...",
          components: buildWheelComponents(segments, currentIndex)
        });
      }

      // 4) Результат
      if (!isWin) {
        await wheelMsg.edit({
          content: "😢 Увы, в этот раз без промокода. Попробуй завтра!",
          components: buildWheelComponents(segments, finalIndex)
        });
        return;
      }

      const discount = parseInt(targetLabel, 10); // из "NN%"
      await pool.query("INSERT INTO promos (user_id, discount) VALUES ($1, $2)", [userId, discount]);

      await wheelMsg.edit({
        content: "",
        embeds: [
          new EmbedBuilder()
            .setTitle("🎉 Поздравляем!")
            .setDescription(`Ты выиграл промокод на **${discount}%** скидку!\n\nКрутить снова можно через 24 часа.`)
            .setColor("#00ff88")
        ],
        components: buildWheelComponents(segments, finalIndex)
      });

      await sendLog("🎁 Новый промокод", `Пользователь: <@${userId}>\nСкидка: **${discount}%**`);
      return;
    }

    // === !профиль
    if (cmd === "!профиль") {
      const userId = message.author.id;
      const res = await pool.query(
        "SELECT id, discount, created_at FROM promos WHERE user_id=$1 ORDER BY id ASC",
        [userId]
      );
      const hasPromo = res.rowCount > 0;

      // ⚠️ Зависит от твоей логики my_table
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
          { name: "🎟 Активные промокоды", value: promoList, inline: false },
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

    // === !передать
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
        /* ignore DM errors */
      }

      await sendLog(
        "🔄 Передача промокода",
        `От: <@${message.author.id}>\nКому: <@${targetUser.id}>\nID промокода: **${promoId}** (${promo.rows[0].discount}%)`
      );
      return;
    }

    // === Админ-команды ===
    if (message.author.id !== ADMIN_ID) return;

    // !выдатьпромо @user <скидка>
    if (cmd === "!выдатьпромо") {
      let target = message.mentions.users.first() || null;
      let discountIdx = 1;

      if (!target && args[0]) {
        try {
          target = await client.users.fetch(args[0]);
          discountIdx = 1;
        } catch {
          /* ignore */
        }
      }

      const discount = parseInt(args[discountIdx], 10);

      if (!target || !Number.isInteger(discount) || discount < 1 || discount > 100) {
        return message.reply("⚙️ Формат: `!выдатьпромо @пользователь <1..100>` (например, `!выдатьпромо @User 25`)");
      }

      await pool.query("INSERT INTO promos (user_id, discount) VALUES ($1, $2)", [target.id, discount]);

      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Промокод выдан")
            .setDescription(`Получатель: <@${target.id}>\nСкидка: **${discount}%**`)
            .setColor("#00c853")
        ]
      });

      try {
        await target.send(`🎁 Администратор выдал тебе промокод со скидкой **${discount}%**!`);
      } catch {}

      await sendLog(
        "🏷️ Выдача промокода (админ)",
        `Админ: <@${message.author.id}>\nКому: <@${target.id}>\nСкидка: **${discount}%**`
      );
      return;
    }

    // !выдать (токен)
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

    // !лист
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

    // !удалить
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
