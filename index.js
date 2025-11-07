import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
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

// === Каталог товаров ===
const CATALOG = {
  pro:  { key: "pro",  name: "PRO",  price: 499, durationDays: 30, desc: "Полный доступ" },
  beta: { key: "beta", name: "BETA", price: 199, durationDays: 30, desc: "Базовый доступ" }
};

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

// === Основной JS для внешнего скрипта ===
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

  // Промокоды (выигранные/выданные)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS promos (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      discount INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Кулдаун рулетки
  await pool.query(`
    CREATE TABLE IF NOT EXISTS promo_cooldowns (
      user_id TEXT PRIMARY KEY,
      last_spin_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // История покупок
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      product TEXT NOT NULL,
      base_price INTEGER NOT NULL,
      discount INTEGER NOT NULL DEFAULT 0,
      final_price INTEGER NOT NULL,
      promo_id INTEGER,
      token TEXT,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

// === Утилиты ===
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function generateToken(len = 28) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function pricePreview(productKey, discountPct) {
  const item = CATALOG[productKey];
  if (!item) return "—";
  const base = item.price;
  const final = Math.max(0, Math.round(base * (1 - (discountPct || 0) / 100)));
  return `₴${base}  →  **₴${final}**  (${discountPct || 0}% скидка)`;
}

// === Рулетка (кнопочный визуал) ===
function buildWheelComponents(segments, activeIndex) {
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 4; c++) {
      const i = r * 4 + c;
      const label = segments[i];
      let style = label === "—" ? ButtonStyle.Secondary : ButtonStyle.Success;
      if (i === activeIndex) style = ButtonStyle.Primary;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`spin_${i}`)
          .setLabel(label)
          .setStyle(style)
          .setDisabled(true)
      );
    }
    rows.push(row);
  }
  return rows;
}

// === Покупка: UI-компоненты ===
function buildBuyComponents(session, promos) {
  // селект товаров
  const productSelect = new StringSelectMenuBuilder()
    .setCustomId(`buy_product:${session.userId}:${session.id}`)
    .setPlaceholder("Выбери тариф")
    .addOptions(
      ...Object.values(CATALOG).map((p) => ({
        label: `${p.name} — ₴${p.price} / ${p.durationDays}д`,
        description: p.desc,
        value: p.key
      }))
    )
    .setMinValues(1)
    .setMaxValues(1);

  // селект промо
  const promoOptions = [
    {
      label: "Без промокода",
      description: "Покупка без скидки",
      value: "none"
    },
    ...promos.map((r) => ({
      label: `#${r.id} — ${r.discount}%`,
      description: "Сгорит при покупке",
      value: `promo_${r.id}`
    }))
  ];

  const promoSelect = new StringSelectMenuBuilder()
    .setCustomId(`buy_promo:${session.userId}:${session.id}`)
    .setPlaceholder("Выбери промокод (необязательно)")
    .addOptions(...promoOptions)
    .setMinValues(1)
    .setMaxValues(1);

  const row1 = new ActionRowBuilder().addComponents(productSelect);
  const row2 = new ActionRowBuilder().addComponents(promoSelect);
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`buy_confirm:${session.userId}:${session.id}`)
      .setLabel("🛒 Оформить")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`buy_cancel:${session.userId}:${session.id}`)
      .setLabel("✖️ Отмена")
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2, row3];
}

function buildBuyEmbed(session, promos) {
  const productPart = session.productKey
    ? `**${CATALOG[session.productKey].name}** (${CATALOG[session.productKey].durationDays} дней)`
    : "_не выбран_";

  const promoPart = session.promoId
    ? `#${session.promoId}`
    : "Без промокода";

  const discountPct = session.promoDiscount || 0;
  const preview = session.productKey ? pricePreview(session.productKey, discountPct) : "—";

  const embed = new EmbedBuilder()
    .setTitle("🛒 Оформление покупки")
    .setColor("#00c853")
    .setDescription(
      "Выбери тариф и, при желании, промокод в выпадающих списках ниже.\n" +
      "Затем нажми **«Оформить»**."
    )
    .addFields(
      { name: "Тариф", value: productPart, inline: true },
      { name: "Промокод", value: promoPart, inline: true },
      { name: "Предпросчёт", value: preview, inline: false }
    )
    .setFooter({ text: "Токен придёт тебе в ЛС после оплаты" })
    .setTimestamp();

  return embed;
}

// === Сессии покупки (по сообщению) ===
const buySessions = new Map(); // messageId -> { id, userId, productKey, promoId, promoDiscount }

// === Команды Discord ===
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  try {
    // === !промо — рулетка с визуалом
    if (cmd === "!промо") {
      const userId = message.author.id;

      // Кулдаун 24ч (UPSERT-гейт)
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

      // Рулетка
      const segments = ["—", "5%", "—", "10%", "—", "15%", "—", "20%", "—", "30%", "—", "60%"];
      const isWin = Math.random() < 0.10;
      const prizeList = [5, 10, 15, 20, 30, 60];
      const targetLabel = isWin ? `${prizeList[Math.floor(Math.random() * prizeList.length)]}%` : "—";
      const candidateIdx = segments.map((v, i) => (v === targetLabel ? i : -1)).filter((i) => i !== -1);
      const finalIndex = candidateIdx[Math.floor(Math.random() * candidateIdx.length)];
      let currentIndex = Math.floor(Math.random() * segments.length);
      const spins = 2 + Math.floor(Math.random() * 3);
      const stepsToFinal =
        spins * segments.length + ((finalIndex - currentIndex + segments.length) % segments.length);

      let wheelMsg = await message.reply({
        content: "🎡 Запускаю рулетку...",
        components: buildWheelComponents(segments, currentIndex)
      });

      for (let step = 0; step < stepsToFinal; step++) {
        currentIndex = (currentIndex + 1) % segments.length;
        const t = (step + 1) / stepsToFinal;
        const delay = Math.round(80 + (420 - 80) * (t * t));
        await sleep(delay);
        await wheelMsg.edit({
          content: t < 0.85 ? "🎡 Крутится..." : "🎯 Почти...",
          components: buildWheelComponents(segments, currentIndex)
        });
      }

      if (!isWin) {
        await wheelMsg.edit({
          content: "😢 Увы, в этот раз без промокода. Попробуй завтра!",
          components: buildWheelComponents(segments, finalIndex)
        });
        return;
      }

      const discount = parseInt(targetLabel, 10);
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

    // === !купить — ПАНЕЛЬ ВЫБОРА (без ввода текста)
    if (cmd === "!купить") {
      const userId = message.author.id;

      // Получаем доступные промокоды
      const promosRes = await pool.query(
        "SELECT id, discount FROM promos WHERE user_id=$1 ORDER BY id ASC",
        [userId]
      );
      const promos = promosRes.rows; // [{id, discount}]

      // Создаём сессию по сообщению
      const session = {
        id: Math.random().toString(36).slice(2, 10),
        userId,
        productKey: null,
        promoId: null,
        promoDiscount: 0
      };

      const embed = buildBuyEmbed(session, promos);
      const components = buildBuyComponents(session, promos);

      const msg = await message.reply({ embeds: [embed], components });

      // запомним сессию по message.id
      buySessions.set(msg.id, session);
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

      // ⚠️ Проверка доступа здесь формальная (в my_table хранятся не userId)
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
              "🛒 Купить доступ — `!купить`\n" +
              "📅 Рулетка — `!промо`",
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
      } catch { /* ignore */ }

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
        } catch { /* ignore */ }
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

    // !выдать (токен вручную)
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

// === Обработка интеракций (селекты/кнопки для покупки) ===
client.on("interactionCreate", async (interaction) => {
  try {
    // работаем только с нашими кастом-id
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

    const [kind, who, sid] = interaction.customId.split(":");
    const messageId = interaction.message?.id;
    const session = buySessions.get(messageId);

    // валидность сессии
    if (!session || session.id !== sid) {
      return interaction.reply({ content: "⚠️ Сессия устарела. Набери `!купить` ещё раз.", ephemeral: true });
    }
    if (interaction.user.id !== session.userId || interaction.user.id !== who) {
      return interaction.reply({ content: "⛔ Эта панель не для тебя.", ephemeral: true });
    }

    // подгрузим актуальные промо пользователя (для меню/проверок)
    const promosRes = await pool.query(
      "SELECT id, discount FROM promos WHERE user_id=$1 ORDER BY id ASC",
      [session.userId]
    );
    const promos = promosRes.rows;

    if (interaction.isStringSelectMenu()) {
      const value = interaction.values[0];

      if (kind === "buy_product") {
        // Выбран тариф
        if (!CATALOG[value]) {
          return interaction.reply({ content: "⚠️ Неизвестный тариф.", ephemeral: true });
        }
        session.productKey = value;

      } else if (kind === "buy_promo") {
        if (value === "none") {
          session.promoId = null;
          session.promoDiscount = 0;
        } else {
          const id = parseInt(value.replace("promo_", ""), 10);
          const found = promos.find((p) => p.id === id);
          if (!found) {
            session.promoId = null;
            session.promoDiscount = 0;
            await interaction.reply({ content: "⚠️ Этот промокод недоступен.", ephemeral: true });
          } else {
            session.promoId = id;
            session.promoDiscount = found.discount;
          }
        }
      }

      // Обновляем панель с предпросчётом
      const embed = buildBuyEmbed(session, promos);
      const components = buildBuyComponents(session, promos);
      await interaction.update({ embeds: [embed], components });
      return;
    }

    // Кнопки
    if (interaction.isButton()) {
      if (kind === "buy_cancel") {
        buySessions.delete(messageId);
        const components = interaction.message.components.map((row) => {
          row.components.forEach((c) => c.setDisabled(true));
          return row;
        });
        await interaction.update({
          embeds: [new EmbedBuilder().setColor("#9e9e9e").setTitle("❎ Покупка отменена")],
          components
        });
        return;
      }

      if (kind === "buy_confirm") {
        if (!session.productKey) {
          return interaction.reply({ content: "❗ Сначала выбери тариф.", ephemeral: true });
        }

        // Финально сверим промо: если выбран — «заберём» (DELETE ... RETURNING)
        let discount = 0;
        let usedPromoId = null;
        if (session.promoId) {
          const del = await pool.query(
            "DELETE FROM promos WHERE id=$1 AND user_id=$2 RETURNING discount;",
            [session.promoId, session.userId]
          );
          if (del.rowCount > 0) {
            discount = Math.min(100, Math.max(0, parseInt(del.rows[0].discount, 10) || 0));
            usedPromoId = session.promoId;
          } else {
            // промо уже использован/передан — идём без скидки
            discount = 0;
            usedPromoId = null;
          }
        }

        const item = CATALOG[session.productKey];
        const base = item.price;
        const final = Math.max(0, Math.round(base * (1 - discount / 100)));
        const expiresAt = new Date(Date.now() + item.durationDays * 24 * 60 * 60 * 1000);

        // Сгенерим токен и сохраним
        let token = generateToken();
        for (let i = 0; i < 5; i++) {
          try {
            await pool.query("INSERT INTO my_table (token, expires_at) VALUES ($1, $2)", [token, expiresAt]);
            break;
          } catch (e) {
            token = generateToken();
            if (i === 4) throw e;
          }
        }

        // Зафиксируем заказ
        const ord = await pool.query(
          `INSERT INTO orders (user_id, product, base_price, discount, final_price, promo_id, token, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id;`,
          [session.userId, item.name, base, discount, final, usedPromoId, token, expiresAt]
        );
        const orderId = ord.rows[0].id;

        // Выключим кнопки
        const components = interaction.message.components.map((row) => {
          row.components.forEach((c) => c.setDisabled(true));
          return row;
        });

        await interaction.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("🧾 Заказ оформлен")
              .setColor("#00c853")
              .addFields(
                { name: "Товар", value: `${item.name} (${item.durationDays} дней)`, inline: true },
                { name: "Цена", value: `₴${base}`, inline: true },
                { name: "Скидка", value: `${discount}%`, inline: true },
                { name: "К оплате", value: `**₴${final}**`, inline: true },
                { name: "ID заказа", value: `#${orderId}`, inline: true },
                { name: "Действует до", value: expiresAt.toLocaleString("ru-RU"), inline: true }
              )
              .setFooter({ text: "Токен отправлен в личные сообщения" })
          ],
          components
        });

        // Отправим токен в ЛС
        try {
          const user = await client.users.fetch(session.userId);
          await user.send(
            `🔐 **Токен доступа (${item.name})**\n` +
            `\`${token}\`\n` +
            `Действует до: **${expiresAt.toLocaleString("ru-RU")}**\n\n` +
            `Используй этот токен в своём лаунчере/скрипте.`
          );
        } catch {
          // если ЛС закрыт — сообщим публично
          await interaction.followUp({
            content: "⚠️ Не удалось отправить токен в ЛС. Открой личные сообщения и напиши мне — пришлю токен туда.",
            ephemeral: true
          });
        }

        await sendLog(
          "💳 Покупка",
          `Пользователь: <@${session.userId}>\nТовар: **${item.name}**\nЦена: ₴${base}\nСкидка: ${discount}%\nИтого: **₴${final}**\nOrderID: #${orderId}`
        );

        buySessions.delete(messageId);
        return;
      }
    }
  } catch (err) {
    console.error("interactionCreate error:", err);
    if (interaction.isRepliable()) {
      try { await interaction.reply({ content: "⚠️ Ошибка при обработке действия.", ephemeral: true }); } catch {}
    }
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
