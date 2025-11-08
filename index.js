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

// === Единственный продукт ===
const PRODUCT = { key: "script", name: "подписка", price: 300, durationDays: 30, desc: "Доступ к скрипту" };

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

// === Проверка токена (теперь токены = HWID) ===
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
        `Токен(HWID): \`${token}\`\nIP: ${ip}\nРезультат: **${valid ? "✅ true" : "❌ false"}**`
      );
    }
  } catch (err) {
    console.error("Ошибка проверки токена:", err);
    res.status(500).json({ error: "DB error" });
  }
});

// === Выдача внешнего JS ===
app.post("/run", async (req, res) => {
  try {
    const { token } = req.body; // теперь сюда передают HWID
    if (!token) return res.status(400).send("// Токен (HWID) не указан");
    const result = await pool.query("SELECT 1 FROM my_table WHERE token=$1", [token]);
    const valid = result.rowCount > 0;
    if (!valid) return res.status(403).send("// HWID не найден / доступ не активен");

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
      token TEXT UNIQUE NOT NULL,      -- здесь храним HWID
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS promos (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      discount INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS promo_cooldowns (
      user_id TEXT PRIMARY KEY,
      last_spin_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      product TEXT NOT NULL,
      base_price INTEGER NOT NULL,
      discount INTEGER NOT NULL DEFAULT 0,
      final_price INTEGER NOT NULL,
      promo_id INTEGER,
      expires_at TIMESTAMP,            -- срок действия доступа
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hwids (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      hwid TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // один HWID на пользователя
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS hwids_user_unique ON hwids(user_id);`);
  // (для истории) чтобы один и тот же HWID не добавляли в my_table дважды
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS my_table_token_unique ON my_table(token);`);

  console.log("✅ Таблицы проверены");
}

// === Очистка просроченных HWID-доступов ===
async function removeExpiredTokens() {
  const now = new Date();
  const res = await pool.query("DELETE FROM my_table WHERE expires_at <= $1 RETURNING token", [now]);
  for (const row of res.rows) {
    await sendLog("🕒 Доступ по HWID истёк", `\`${row.token}\``);
  }
}

// === Утилиты ===
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function pricePreview(discountPct) {
  const base = PRODUCT.price;
  const final = Math.max(0, Math.round(base * (1 - (discountPct || 0) / 100)));
  return `₽${base}  →  **₽${final}**  (${discountPct || 0}% скидка)`;
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

// === Покупка: UI-компоненты (выбор промо, при выборе — сгорает) ===
function buildBuyComponents(session, promos, locked) {
  const promoOptions = [
    {
      label: "Без промокода",
      description: locked ? "Промокод уже применён — изменить нельзя" : "Покупка без скидки",
      value: "none",
      default: !session.promoLocked && !session.promoId
    },
    ...promos.map((r) => ({
      label: `#${r.id} — ${r.discount}%`,
      description: "Выбор сожжёт промокод без возможности вернуть",
      value: `promo_${r.id}`,
      default: session.promoId === r.id
    }))
  ];

  const promoSelect = new StringSelectMenuBuilder()
    .setCustomId(`buy_promo:${session.userId}:${session.id}`)
    .setPlaceholder(locked ? "Промокод применён" : "Выбери промокод (необязательно)")
    .addOptions(...promoOptions)
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(!!locked);

  const rowPromo = new ActionRowBuilder().addComponents(promoSelect);
  const rowButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`buy_confirm:${session.userId}:${session.id}`)
      .setLabel("🛒 Оформить")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`buy_cancel:${session.userId}:${session.id}`)
      .setLabel("✖️ Отмена")
      .setStyle(ButtonStyle.Secondary)
  );

  return [rowPromo, rowButtons];
}

function buildBuyEmbed(session) {
  const discountPct = session.promoDiscount || 0;
  const preview = pricePreview(discountPct);

  return new EmbedBuilder()
    .setTitle("🛒 Оформление покупки")
    .setColor("#00c853")
    .setDescription(
      `Тариф: **${PRODUCT.name}** — ₽${PRODUCT.price} / ${PRODUCT.durationDays}д\n` +
      `Описание: ${PRODUCT.desc}\n\n` +
      `Выбери промокод ниже (при выборе он **сразу сгорает** и вернуть его нельзя), затем жми **«Оформить»**.\n\n` +
      `После оформления введи: **!add_hwid <HWID>** (в твой доступ попадёт именно этот HWID).`
    )
    .addFields(
      { name: "Промокод", value: session.promoLocked ? `#${session.promoId} (${session.promoDiscount}%)` : (session.promoId ? `#${session.promoId} (${session.promoDiscount}%)` : "Без промокода"), inline: true },
      { name: "Предпросчёт", value: preview, inline: true }
    )
    .setTimestamp();
}

// === Сессии покупки ===
const buySessions = new Map(); // messageId -> { id, userId, promoId, promoDiscount, promoLocked }

// === Команды Discord ===
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  try {
    // === !промо — рулетка с кулдауном 24ч
    if (cmd === "!промо") {
      const userId = message.author.id;

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
        const last = await pool.query(`SELECT last_spin_at FROM promo_cooldowns WHERE user_id=$1`, [userId]);
        const lastTime = new Date(last.rows[0].last_spin_at).getTime();
        const remainMs = Math.max(0, 24 * 60 * 60 * 1000 - (Date.now() - lastTime));
        const remainHours = (remainMs / (1000 * 60 * 60)).toFixed(1);
        await message.reply(`⏰ Ты уже крутил колесо недавно! Попробуй снова через **${remainHours} ч.**`);
        return;
      }

      const segments = ["—", "5%", "—", "10%", "—", "15%", "—", "20%", "—", "30%", "—", "60%"];
      const isWin = Math.random() < 0.10;
      const prizeList = [5, 10, 15, 20, 30, 60];
      const targetLabel = isWin ? `${prizeList[Math.floor(Math.random() * prizeList.length)]}%` : "—";
      const candidateIdx = segments.map((v, i) => (v === targetLabel ? i : -1)).filter((i) => i !== -1);
      const finalIndex = candidateIdx[Math.floor(Math.random() * candidateIdx.length)];
      let currentIndex = Math.floor(Math.random() * segments.length);
      const spins = 2 + Math.floor(Math.random() * 3);
      const stepsToFinal = spins * segments.length + ((finalIndex - currentIndex + segments.length) % segments.length);

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

    // === !купить — выбор/сжигание промокода, без ввода товара
    if (cmd === "!купить") {
      const userId = message.author.id;

      const promosRes = await pool.query(
        "SELECT id, discount FROM promos WHERE user_id=$1 ORDER BY id ASC",
        [userId]
      );
      const promos = promosRes.rows;

      const session = {
        id: Math.random().toString(36).slice(2, 10),
        userId,
        promoId: null,
        promoDiscount: 0,
        promoLocked: false
      };

      const embed = buildBuyEmbed(session);
      const components = buildBuyComponents(session, promos, session.promoLocked);

      const msg = await message.reply({ embeds: [embed], components });
      buySessions.set(msg.id, session);
      return;
    }

    // === !add_hwid <HWID> — пользователь добавляет СВОЙ единственный HWID
    if (cmd === "!add_hwid") {
      const userId = message.author.id;
      const hwid = (args.join(" ") || "").trim();

      if (!hwid) {
        await message.reply("⚙️ Формат: `!add_hwid <HWID>` (вставь свой HWID строкой)");
        return;
      }
      if (hwid.length > 100) {
        await message.reply("⚠️ Слишком длинный HWID (максимум 100 символов).");
        return;
      }

      // 1) уже есть HWID у пользователя?
      const hasHwid = await pool.query("SELECT 1 FROM hwids WHERE user_id=$1 LIMIT 1", [userId]);
      if (hasHwid.rowCount > 0) {
        await message.reply("🔒 У тебя уже привязан HWID. Второй добавить нельзя.");
        return;
      }

      // 2) проверим наличие актуального заказа
      const activeOrder = await pool.query(
        `SELECT expires_at
         FROM orders
         WHERE user_id=$1
         ORDER BY expires_at DESC
         LIMIT 1`,
        [userId]
      );
      if (activeOrder.rowCount === 0) {
        await message.reply("🛒 Сначала оформи покупку `!купить`, затем добавь HWID.");
        return;
      }
      const orderExpiresAt = new Date(activeOrder.rows[0].expires_at);
      if (isNaN(orderExpiresAt.getTime()) || orderExpiresAt <= new Date()) {
        await message.reply("⌛ Срок твоей покупки истёк или не найден. Оформи новую через `!купить`.");
        return;
      }

      // 3) Попробуем завести HWID как access-токен (в my_table). Он должен быть уникален.
      try {
        await pool.query("INSERT INTO my_table (token, expires_at) VALUES ($1, $2)", [hwid, orderExpiresAt]);
      } catch (e) {
        // нарушена уникальность -> HWID уже используется (кем-то)
        await message.reply("⚠️ Этот HWID уже занят в системе. Укажи другой HWID.");
        return;
      }

      // 4) Сохраним привязку пользователя -> HWID (ровно один)
      const ins = await pool.query(
        "INSERT INTO hwids (user_id, hwid) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING",
        [userId, hwid]
      );
      if (ins.rowCount === 0) {
        // кто-то успел привязать в гонке — откатим вставку в my_table
        await pool.query("DELETE FROM my_table WHERE token=$1", [hwid]);
        await message.reply("🔒 У тебя уже есть привязанный HWID.");
        return;
      }

      await message.reply(`🔐 HWID \`${hwid}\` добавлен. Теперь доступ активен до **${orderExpiresAt.toLocaleString("ru-RU")}**.`);
      await sendLog("🖥️ Добавлен HWID", `Пользователь: <@${userId}>\nHWID: \`${hwid}\`\nДействует до: ${orderExpiresAt.toLocaleString("ru-RU")}`);
      return;
    }

    // === !профиль — доступ = есть ли привязанный HWID
    if (cmd === "!профиль") {
      const userId = message.author.id;

      const promoRes = await pool.query(
        "SELECT id, discount, created_at FROM promos WHERE user_id=$1 ORDER BY id ASC",
        [userId]
      );

      const hwidsRes = await pool.query(
        "SELECT hwid, created_at FROM hwids WHERE user_id=$1 ORDER BY id ASC",
        [userId]
      );
      const hasAccess = hwidsRes.rowCount > 0;

      const promoList = promoRes.rowCount
        ? promoRes.rows.map((r) => `🔹 **#${r.id}** — ${r.discount}% (выдан ${new Date(r.created_at).toLocaleDateString("ru-RU")})`).join("\n")
        : "Промокоды пока отсутствуют 😔";

      const hwidList = hwidsRes.rowCount
        ? hwidsRes.rows.map((r, i) => `• **HWID #${i + 1}**: \`${r.hwid}\` (добавлен ${new Date(r.created_at).toLocaleDateString("ru-RU")})`).join("\n")
        : "Ещё не добавлен. После покупки введи: `!add_hwid <HWID>`";

      const embed = new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("🌟 Профиль пользователя")
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
        .setDescription(
          `**👤 Пользователь:** ${message.author.username}\n` +
          `**💼 Наличие подписки:** ${hasAccess ? "✅ есть" : "❌ нету"}`
        )
        .addFields(
          { name: "🎟 Промокоды", value: promoList, inline: false },
          { name: "🖥 HWID-привязка", value: hwidList, inline: false },
          {
            name: "ℹ️ Команды",
            value:
              "🛒 Купить — `!купить`\n" +
              "🎯 Рулетка — `!промо`\n" +
              "🔐 Привязать HWID — `!add_hwid <HWID>`",
            inline: false
          }
        )
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      return;
    }

    // === !передать (промокод)
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
      } catch {}
      await sendLog(
        "🔄 Передача промокода",
        `От: <@${message.author.id}>\nКому: <@${targetUser.id}>\nID промокода: **${promoId}** (${promo.rows[0].discount}%)`
      );
      return;
    }

    // === Админ-команды ===
    if (message.author.id !== ADMIN_ID) return;

    if (cmd === "!выдатьпромо") {
      let target = message.mentions.users.first() || null;
      let discountIdx = 1;

      if (!target && args[0]) {
        try { target = await client.users.fetch(args[0]); discountIdx = 1; } catch {}
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

      try { await target.send(`🎁 Администратор выдал тебе промокод со скидкой **${discount}%**!`); } catch {}
      await sendLog("🏷️ Выдача промокода (админ)", `Админ: <@${message.author.id}>\nКому: <@${target.id}>\nСкидка: **${discount}%**`);
      return;
    }

    if (cmd === "!выдать") {
      // админ вручную добавляет HWID в белый список (например, когда выдали доступ руками)
      const hwid = args[0];
      if (!hwid) return message.reply("⚙️ Формат: `!выдать <HWID>`");

      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1);

      try {
        await pool.query("INSERT INTO my_table(token, expires_at) VALUES($1,$2)", [hwid, expiresAt]);
        await message.reply(`✅ HWID \`${hwid}\` добавлен. Истекает: ${expiresAt.toLocaleString("ru-RU")}`);
      } catch (err) {
        await message.reply("⚠️ Ошибка: возможно, такой HWID уже существует.");
      }
      return;
    }

    if (cmd === "!лист") {
      await removeExpiredTokens();
      const res = await pool.query("SELECT token, expires_at FROM my_table ORDER BY id DESC");
      const list = res.rows.length
        ? res.rows.map(r => `• HWID \`${r.token}\` — истекает ${new Date(r.expires_at).toLocaleString("ru-RU")}`).join("\n")
        : "Нет активных HWID.";
      const embed = new EmbedBuilder()
        .setTitle("📋 Список активных HWID")
        .setDescription(list)
        .setColor("#2f3136");
      await message.reply({ embeds: [embed] });
      return;
    }

    if (cmd === "!удалить") {
      const hwid = args[0];
      if (!hwid) return message.reply("⚙️ Формат: `!удалить <HWID>`");
      await pool.query("DELETE FROM my_table WHERE token=$1", [hwid]);
      await pool.query("DELETE FROM hwids WHERE hwid=$1", [hwid]);
      await message.reply("🗑️ Удалено (если было).");
      return;
    }

  } catch (err) {
    console.error("Ошибка команды:", err);
    await message.reply("⚠️ Ошибка при выполнении команды.");
  }
});

// === Интеракции (покупка) ===
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

    const [kind, who, sid] = interaction.customId.split(":");
    const messageId = interaction.message?.id;
    const session = buySessions.get(messageId);

    if (!session || session.id !== sid) {
      return interaction.reply({ content: "⚠️ Сессия устарела. Набери `!купить` ещё раз.", ephemeral: true });
    }
    if (interaction.user.id !== session.userId || interaction.user.id !== who) {
      return interaction.reply({ content: "⛔ Эта панель не для тебя.", ephemeral: true });
    }

    const promosRes = await pool.query(
      "SELECT id, discount FROM promos WHERE user_id=$1 ORDER BY id ASC",
      [session.userId]
    );
    const promos = promosRes.rows;

    if (interaction.isStringSelectMenu()) {
      const value = interaction.values[0];

      if (kind === "buy_promo") {
        if (session.promoLocked) {
          return interaction.reply({ content: "🔒 Промокод уже выбран — изменить нельзя.", ephemeral: true });
        }

        if (value === "none") {
          session.promoId = null;
          session.promoDiscount = 0;
          const embed = buildBuyEmbed(session);
          const components = buildBuyComponents(session, promos, session.promoLocked);
          await interaction.update({ embeds: [embed], components });
          return;
        }

        // Сжигаем промокод сразу
        const id = parseInt(value.replace("promo_", ""), 10);
        const del = await pool.query(
          "DELETE FROM promos WHERE id=$1 AND user_id=$2 RETURNING discount;",
          [id, session.userId]
        );
        if (del.rowCount === 0) {
          return interaction.reply({ content: "⚠️ Этот промокод недоступен или уже использован.", ephemeral: true });
        }
        session.promoId = id;
        session.promoDiscount = Math.min(100, Math.max(0, parseInt(del.rows[0].discount, 10) || 0));
        session.promoLocked = true;

        const embed = buildBuyEmbed(session);
        const components = buildBuyComponents(session, [], true); // меню промо блокируем
        await interaction.update({ embeds: [embed], components });
        return;
      }
    }

    if (interaction.isButton()) {
      if (kind === "buy_cancel") {
        buySessions.delete(messageId);
        await interaction.update({
          embeds: [new EmbedBuilder().setColor("#9e9e9e").setTitle("❎ Покупка отменена")],
          components: []
        });
        return;
      }

      if (kind === "buy_confirm") {
        const base = PRODUCT.price;
        const discount = session.promoDiscount || 0;
        const final = Math.max(0, Math.round(base * (1 - discount / 100)));
        const expiresAt = new Date(Date.now() + PRODUCT.durationDays * 24 * 60 * 60 * 1000);

        // Создаём заказ (без токена; токен = HWID добавит сам пользователь)
        const ord = await pool.query(
          `INSERT INTO orders (user_id, product, base_price, discount, final_price, promo_id, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id;`,
          [session.userId, PRODUCT.name, base, discount, final, session.promoId, expiresAt]
        );
        const orderId = ord.rows[0].id;

        await interaction.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("🧾 Заказ оформлен")
              .setColor("#00c853")
              .addFields(
                { name: "Товар", value: `${PRODUCT.name} (${PRODUCT.durationDays} дней)`, inline: true },
                { name: "Цена", value: `₽${base}`, inline: true },
                { name: "Скидка", value: `${discount}%`, inline: true },
                { name: "К оплате", value: `**₽${final}**`, inline: true },
                { name: "ID заказа", value: `#${orderId}`, inline: true },
                { name: "Действует до", value: expiresAt.toLocaleString("ru-RU"), inline: true }
              )
              .setFooter({ text: "Теперь введи: !add_hwid <HWID> (будет добавлен в белый список)" })
          ],
          components: []
        });

        try {
          const user = await client.users.fetch(session.userId);
          await user.send(
            `✅ Покупка оформлена. Срок доступа до **${expiresAt.toLocaleString("ru-RU")}**.\n` +
            `Теперь привяжи устройство:\n` +
            `**!add_hwid <HWID>**\n\n` +
            `В белый список попадёт именно указанный тобой HWID.`
          );
        } catch {}

        await sendLog(
          "💳 Покупка",
          `Пользователь: <@${session.userId}>\nТовар: **${PRODUCT.name}**\nЦена: ₽${base}\nСкидка: ${discount}%\nИтого: **₽${final}**\nOrderID: #${orderId}\nИстекает: ${expiresAt.toLocaleString("ru-RU")}`
        );

        buySessions.delete(messageId);
        return;
      }
    }
  } catch (err) {
    console.error("interactionCreate error:", err);
    try {
      if (interaction.isRepliable()) {
        await interaction.reply({ content: "⚠️ Ошибка при обработке действия.", ephemeral: true });
      }
    } catch {}
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
