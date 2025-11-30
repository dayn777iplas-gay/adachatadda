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
import mysql from 'mysql2/promise';
import express from "express";
import cors from "cors";

// === Конфигурация ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_ID = process.env.ADMIN_ID;

const LOG_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1427826300495855697/MtqkHw-X8jm7l8kbIxeVJHvBNcIPufZtxssqd2-wyljCggs9lGi4SMZZivbSckSw7xTU";

if (!BOT_TOKEN || !DATABASE_URL || !ADMIN_ID) {
  console.error("❌ BOT_TOKEN, DATABASE_URL и ADMIN_ID обязательны!");
  process.exit(1);
}

const fetch = global.fetch;

// === Единственный продукт ===
const PRODUCT = {
  key: "script",
  name: "подписка",
  price: 300,
  durationDays: 30,
  desc: "Доступ к скрипту"
};

// === Подключение PostgreSQL ===
const pool = mysql.createPool(DATABASE_URL);
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// === Discord клиент ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites
  ],
  partials: [Partials.Channel]
});

// === Express ===
const app = express();
app.use(cors());
app.use(express.json());
app.get("/", (req, res) => res.send("Bot is running..."));

// === Анти-спам логов (in-memory) ===
const LOG_WINDOW_MS = 5 * 60 * 1000; // 5 минут
const lastLogAt = new Map(); // key -> timestamp(ms)

// === Виртуальная валюта и кейсы ===
const COINS_PER_INVITE = 20; // сколько монет даём за приглашённого юзера
const COINS_PER_PURCHASE = 100; // сколько монет за каждую покупку
const CASE_PRICE = 50; // цена кейса в монетах

// Укажи реальные ID ролей из твоего сервера:
const CASE_ROLE_IDS = [
  "1442923957279002635", // например, VIP
  "1442925465818894437" // например, PREMIUM
];

// Пул наград кейса (включая "свою роль")
const CASE_REWARDS = [
  { type: "nothing", label: "Ничего", weight: 38 },
  { type: "coins", label: "10 монет", amount: 10, weight: 25 },
  { type: "coins", label: "25 монет", amount: 25, weight: 15 },
  { type: "promo", label: "Промокод 15%", discount: 15, weight: 8 },
  { type: "promo", label: "Промокод 30%", discount: 30, weight: 6 },
  { type: "custom_role", label: "Своя роль", weight: 4 }, // кастомная роль
  { type: "role", label: "Роль #1", roleId: CASE_ROLE_IDS[0], weight: 3 },
  { type: "role", label: "Роль #2", roleId: CASE_ROLE_IDS[1], weight: 1 }
];

// кэш инвайтов: guildId -> Map(code -> uses)
const invitesCache = new Map();

// ожидаем, что пользователь создаст свою роль после выигрыша в кейсе
// ключ: `${guildId}:${userId}` -> { guildId, count }
const customRoleSessions = new Map();

/**
 * Обёртка над sendLog c анти-спамом.
 * Логируем только если прошло >= windowMs с последнего такого же события.
 * key — идентификатор "одного и того же" события (например: токен + результат).
 */
async function sendLogThrottled(
  title,
  description,
  color = "#2f3136",
  key,
  windowMs = LOG_WINDOW_MS
) {
  try {
    if (key) {
      const now = Date.now();
      const prev = lastLogAt.get(key) || 0;
      if (now - prev < windowMs) return; // пропускаем дубликат в окне
      lastLogAt.set(key, now);
    }
    await sendLog(title, description, color);
  } catch (e) {
    console.error("Ошибка sendLogThrottled:", e);
  }
}

// === Проверка токена (теперь токены = HWID) ===
app.get("/check/:token", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const uaHeader = req.headers["user-agent"] || "—";
  const acceptLang = req.headers["accept-language"] || "—";
  try {
    const token = req.params.token;
    const result = await pool.query("SELECT 1 FROM my_table WHERE token=$1", [token]);
    const valid = result.rowCount > 0;
    res.json({ valid });

    if (token !== "1") {
      // ключ без IP, чтобы не спамило при смене прокси/множественных адресах
      const key = `check:${token}:${valid ? 1 : 0}`;
      await sendLogThrottled(
        "🔎 Проверка токена",
        [
          `Токен(HWID): \`${token}\``,
          `IP: ${ip}`,
          `Результат: **${valid ? "✅ true" : "❌ false"}**`,
          "",
          `User-Agent: ${uaHeader}`,
          `Accept-Language: ${acceptLang}`
        ].join("\n"),
        "#2f3136",
        key,
        LOG_WINDOW_MS
      );
    }
  } catch (err) {
    console.error("Ошибка проверки токена:", err);
    res.status(500).json({ error: "DB error" });
  }
});

// === Эндпоинт для логирования клиентских данных (fingerprint) ===
app.post("/fp", async (req, res) => {
  try {
    const {
      token,
      userAgent,
      platform,
      screen: scr,
      languages,
      timeZone,
      plugins,
      features,
      hardware,
      online
    } = req.body || {};

    if (!token) return res.status(400).json({ error: "token (HWID) is required" });

    const lines = [];

    lines.push(`Токен(HWID): \`${token}\``);
    lines.push(`User-Agent: ${userAgent || "—"}`);
    lines.push(`Платформа (navigator.platform): ${platform || "—"}`);
    lines.push(
      `Разрешение экрана: ${scr?.width ?? "—"}x${scr?.height ?? "—"}, окно: ${
        scr?.innerWidth ?? "—"
      }x${scr?.innerHeight ?? "—"}`
    );
    lines.push(`Глубина цвета: ${scr?.colorDepth ?? "—"}`);
    lines.push(
      `Языки: ${languages?.language || "—"} | [${
        Array.isArray(languages?.languages) && languages.languages.length
          ? languages.languages.join(", ")
          : "—"
      }]`
    );
    lines.push(`Часовой пояс: ${timeZone || "—"}`);
    lines.push(
      `Плагины: ${Array.isArray(plugins) ? (plugins.length ? plugins.join(", ") : "—") : "—"}`
    );
    lines.push(
      `Поддержка API: ${
        features && Object.keys(features).length
          ? Object.entries(features)
              .map(([k, v]) => `${k}:${v ? "✅" : "❌"}`)
              .join(", ")
          : "—"
      }`
    );
    lines.push(
      `Оборудование: ядра=${hardware?.cores ?? "—"}, RAM=${
        hardware?.memory ? `${hardware.memory}GB` : "—"
      }, GPU=${
        [hardware?.gpuVendor, hardware?.gpuRenderer].filter(Boolean).join(" / ") || "—"
      }`
    );
    lines.push(`Online: ${online === undefined ? "—" : online ? "✅" : "❌"}`);

    const key = `fp:${token}`; // троттлим не чаще 1 раза/5мин на токен
    await sendLogThrottled("🧩 Клиентские данные", lines.join("\n"), "#2f3136", key, LOG_WINDOW_MS);

    res.json({ ok: true });
  } catch (err) {
    console.error("Ошибка /fp:", err);
    res.status(500).json({ error: "server error" });
  }
});

// === Выдача внешнего JS ===
app.post("/run", async (req, res) => {
  try {
    const { token } = req.body; // сюда передают HWID
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

  // баланс виртуальной валюты
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_balances (
      user_id TEXT PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0
    );
  `);

  // роли, полученные из кейсов (с указанием владельца)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS case_roles (
      role_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("✅ Таблицы проверены");
}

// === Очистка просроченных HWID-доступов ===
async function removeExpiredTokens() {
  const now = new Date();
  const res = await pool.query("DELETE FROM my_table WHERE expires_at <= $1 RETURNING token", [
    now
  ]);
  for (const row of res.rows) {
    await sendLog("🕒 Доступ по HWID истёк", `\`${row.token}\``);
  }
}

// === Баланс монет ===
async function addCoins(userId, amount) {
  if (!amount) return;
  await pool.query(
    `
    INSERT INTO user_balances (user_id, balance)
    VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE
      SET balance = user_balances.balance + EXCLUDED.balance
    `,
    [userId, amount]
  );
}

async function getBalance(userId) {
  const res = await pool.query("SELECT balance FROM user_balances WHERE user_id=$1", [userId]);
  return res.rowCount ? res.rows[0].balance : 0;
}

async function setBalance(userId, amount) {
  await pool.query(
    `
    INSERT INTO user_balances (user_id, balance)
    VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE
      SET balance = EXCLUDED.balance
    `,
    [userId, amount]
  );
}

// === Рандом по весам (для кейсов) ===
function weightedRandom(items) {
  const total = items.reduce((sum, x) => sum + (x.weight || 1), 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight || 1;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
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
      description: locked
        ? "Промокод уже применён — изменить нельзя"
        : "Покупка без скидки",
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
      {
        name: "Промокод",
        value: session.promoLocked
          ? `#${session.promoId} (${session.promoDiscount}%)`
          : session.promoId
          ? `#${session.promoId} (${session.promoDiscount}%)`
          : "Без промокода",
        inline: true
      },
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
    // === !help / !команды — список всех команд ===
    if (cmd === "!help" || cmd === "!команды") {
      const isAdmin = message.author.id === ADMIN_ID;

      const embed = new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("📘 Список команд")
        .setDescription(
          "Вот список всех доступных команд.\n" +
            "Некоторые команды доступны только администратору."
        )
        .addFields(
          {
            name: "👤 Пользовательские команды",
            value:
              "🛒 **!купить** — оформить покупку подписки\n" +
              "🎯 **!промо** — крутануть рулетку с шансом на скидку\n" +
              "💰 **!баланс** — показать баланс монет\n" +
              "📦 **!кейс** — открыть кейс за монеты\n" +
              "🎨 **!создатьроль <название>** — создать свою роль, если ты выбил её из кейса\n" +
              "🔁 **!передатьроль @user @роль** — передать свою кейс-роль другому\n" +
              "🔁 **!перевод @user <кол-во>** — передать монеты другу\n" +
              "🔐 **!add_hwid <HWID>** — привязать свой HWID\n" +
              "🖥️ **!профиль** — посмотреть свои промокоды и HWID\n" +
              "⏱ **!срок** — узнать срок действия подписки\n" +
              "🎁 **!передать @user <ID>** — передать промокод другому\n",
            inline: false
          },
          {
            name: "⚙️ Прочее",
            value:
              "💡 **!help** / **!команды** — показать это меню\n" +
              "📦 динахуй",
            inline: false
          }
        );

      if (isAdmin) {
        embed.addFields({
          name: "🛠 Админ-команды",
          value:
            "🏷 **!выдатьпромо @user <скидка%>** — выдать промокод\n" +
            "💳 **!выдать <HWID>** — вручную добавить доступ\n" +
            "📋 **!лист** — показать активные HWID\n" +
            "🗑 **!удалить <HWID>** — удалить HWID\n" +
            "📊 **!стата** — статистика проекта\n" +
            "➕ **!выдатькоины @user <кол-во>** — выдать монеты\n",
          inline: false
        });
      }

      embed.setFooter({ text: "TamiNeg-bot создатель Bondyuk" });
      embed.setTimestamp();

      await message.reply({ embeds: [embed] });
      return;
    }

    // === !перевод @user <кол-во> — передать монеты другому пользователю ===
    if (cmd === "!перевод" || cmd === "!передатьмонеты") {
      const senderId = message.author.id;
      const targetUser = message.mentions.users.first();
      const amountRaw = args[1]; // args[0] это @user, args[1] — число

      if (!targetUser || !amountRaw) {
        await message.reply(
          "⚙️ Формат: `!перевод @пользователь <кол-во>`\n" +
          "Пример: `!перевод @User 50`"
        );
        return;
      }

      if (targetUser.id === senderId) {
        await message.reply("😅 Себе монеты переводить нельзя.");
        return;
      }

      const amount = parseInt(amountRaw, 10);
      if (!Number.isInteger(amount) || amount <= 0) {
        await message.reply("⚠️ Сумма должна быть положительным целым числом.");
        return;
      }

      const senderBalance = await getBalance(senderId);
      if (senderBalance < amount) {
        await message.reply(
          `❌ Недостаточно монет. На балансе **${senderBalance}**, нужно **${amount}**.`
        );
        return;
      }

      // сначала списываем с отправителя
      await addCoins(senderId, -amount);
      // потом зачисляем получателю
      await addCoins(targetUser.id, amount);

      const newSenderBalance = await getBalance(senderId);

      await message.reply(
        `💸 Ты перевёл **${amount}** монет пользователю <@${targetUser.id}>.\n` +
        `Твой новый баланс: **${newSenderBalance}** монет.`
      );

      // попробуем уведомить получателя в ЛС
      try {
        await targetUser.send(
          `💰 Тебе перевели **${amount}** монет от пользователя ${message.author.tag}.`
        );
      } catch {}

      await sendLog(
        "💸 Перевод монет",
        `От: <@${senderId}>\nКому: <@${targetUser.id}>\nСумма: **${amount}**`
      );

      return;
    }

    // === !баланс — показать баланс виртуальной валюты ===
    if (cmd === "!баланс" || cmd === "!balance") {
      const bal = await getBalance(message.author.id);

      const embed = new EmbedBuilder()
        .setColor("#ffd54f")
        .setTitle("💰 Баланс монет")
        .setDescription(`У тебя сейчас **${bal}** монет.`)
        .setFooter({ text: "Монеты выдаются за покупки и приглашения друзей." })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      return;
    }

        // === !кейс [кол-во] — открыть один или несколько кейсов за монеты ===
    if (cmd === "!кейс") {
      const userId = message.author.id;
      const bal = await getBalance(userId);

      // args[0] может быть числом: !кейс 5
      const amountRaw = args[0];
      let count = 1;

      if (amountRaw) {
        const parsed = parseInt(amountRaw, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          await message.reply("⚙️ Формат: `!кейс` или `!кейс <кол-во>` (например, `!кейс 5`).");
          return;
        }
        // лимит, чтобы не улететь в рейты и спам
        count = Math.min(parsed, 100);
      }

      const totalCost = CASE_PRICE * count;

      if (bal < totalCost) {
        await message.reply(
          `📦 Цена одного кейса: **${CASE_PRICE}** монет.\n` +
            `Ты пытаешься открыть **${count}** шт. → нужно **${totalCost}** монет.\n` +
            `У тебя на балансе только **${bal}**.`
        );
        return;
      }

      // списываем общую стоимость
      await addCoins(userId, -totalCost);

      const guild = message.guild;
      const member = message.member;

      // счётчики результатов
      let opened = 0;
      let nothingCount = 0;
      let coinsTotal = 0;
      let coinsCases = 0;
      const promoDiscounts = [];
      let customRoleWins = 0;
      const fixedRolesGiven = [];
      const fixedRolesFailed = [];

      for (let i = 0; i < count; i++) {
        const reward = weightedRandom(CASE_REWARDS);
        opened++;

        if (reward.type === "nothing") {
          nothingCount++;
        } else if (reward.type === "coins") {
          coinsTotal += reward.amount;
          coinsCases++;
          await addCoins(userId, reward.amount);
        } else if (reward.type === "promo") {
          promoDiscounts.push(reward.discount);
          await pool.query("INSERT INTO promos (user_id, discount) VALUES ($1, $2)", [
            userId,
            reward.discount
          ]);
        } else if (reward.type === "custom_role") {
          customRoleWins++;
          if (guild && member) {
            const key = `${guild.id}:${userId}`;
            const prev = customRoleSessions.get(key);
            const prevCount = prev?.count || 0;
            customRoleSessions.set(key, { guildId: guild.id, count: prevCount + 1 });
          }
        } else if (reward.type === "role") {
          if (guild && member && reward.roleId) {
            const role = guild.roles.cache.get(reward.roleId);
            if (role) {
              try {
                await member.roles.add(role);
                fixedRolesGiven.push(role.name);
              } catch {
                fixedRolesFailed.push(role.name);
              }
            } else {
              fixedRolesFailed.push(`ID:${reward.roleId}`);
            }
          } else {
            fixedRolesFailed.push(reward.label || `ID:${reward.roleId}`);
          }
        }
      }

      const newBal = await getBalance(userId);

      // собираем красивый текст
      let desc = `Ты открыл **${opened}** кейсов.\n` +
                 `Потрачено: **${totalCost}** монет.\n` +
                 `Текущий баланс: **${newBal}** монет.\n\n` +
                 `📊 Результаты:\n`;

      if (nothingCount > 0) {
        desc += `• Пустых кейсов: **${nothingCount}**\n`;
      }
      if (coinsCases > 0) {
        desc += `• Монеты: **+${coinsTotal}** (из ${coinsCases} кейсов)\n`;
      }
      if (promoDiscounts.length > 0) {
        const map = {};
        for (const d of promoDiscounts) {
          map[d] = (map[d] || 0) + 1;
        }
        const promoLines = Object.entries(map)
          .map(([d, cnt]) => `  └ **${d}%** × ${cnt}`)
          .join("\n");
        desc += `• Промокоды:\n${promoLines}\n`;
      }
      if (customRoleWins > 0) {
        desc +=
          `• Право создать свою роль: **${customRoleWins}** раз(а).\n` +
          "  └ Используй: `!создатьроль <название>` (можно несколько раз, пока есть попытки).\n";
      }
      if (fixedRolesGiven.length > 0) {
        desc += `• Выданные фикс-роли: ${fixedRolesGiven
          .map((n) => `\`${n}\``)
          .join(", ")}\n`;
      }
      if (fixedRolesFailed.length > 0) {
        desc +=
          `• Роли, которые не удалось выдать: ${fixedRolesFailed
            .map((n) => `\`${n}\``)
            .join(", ")} (проверь права бота и ID)\n`;
      }

      if (
        nothingCount === 0 &&
        coinsCases === 0 &&
        promoDiscounts.length === 0 &&
        customRoleWins === 0 &&
        fixedRolesGiven.length === 0 &&
        fixedRolesFailed.length === 0
      ) {
        desc += "• (что-то пошло не так, ничего не выпало 🤔)";
      }

      const embed = new EmbedBuilder()
        .setColor("#ab47bc")
        .setTitle("🎰 Открытие кейсов")
        .setDescription(desc)
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      return;
    }

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
        `,
        [userId]
      );

      if (gate.rowCount === 0) {
        const last = await pool.query(
          `SELECT last_spin_at FROM promo_cooldowns WHERE user_id=$1`,
          [userId]
        );
        const lastTime = new Date(last.rows[0].last_spin_at).getTime();
        const remainMs = Math.max(0, 24 * 60 * 60 * 1000 - (Date.now() - lastTime));
        const remainHours = (remainMs / (1000 * 60 * 60)).toFixed(1);
        await message.reply(
          `⏰ Ты уже крутил колесо недавно! Попробуй снова через **${remainHours} ч.**`
        );
        return;
      }

      const segments = ["—", "5%", "—", "10%", "—", "15%", "—", "20%", "—", "30%", "—", "60%"];
      const isWin = Math.random() < 0.1;
      const prizeList = [5, 10, 15, 20, 30, 60];
      const targetLabel = isWin
        ? `${prizeList[Math.floor(Math.random() * prizeList.length)]}%`
        : "—";
      const candidateIdx = segments
        .map((v, i) => (v === targetLabel ? i : -1))
        .filter((i) => i !== -1);
      const finalIndex = candidateIdx[Math.floor(Math.random() * candidateIdx.length)];
      let currentIndex = Math.floor(Math.random() * segments.length);
      const spins = 2 + Math.floor(Math.random() * 3);
      const stepsToFinal =
        spins * segments.length +
        ((finalIndex - currentIndex + segments.length) % segments.length);

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
      await pool.query("INSERT INTO promos (user_id, discount) VALUES ($1, $2)", [
        userId,
        discount
      ]);

      await wheelMsg.edit({
        content: "",
        embeds: [
          new EmbedBuilder()
            .setTitle("🎉 Поздравляем!")
            .setDescription(
              `Ты выиграл промокод на **${discount}%** скидку!\n\nКрутить снова можно через 24 часа.`
            )
            .setColor("#00ff88")
        ],
        components: buildWheelComponents(segments, finalIndex)
      });

      await sendLog(
        "🎁 Новый промокод",
        `Пользователь: <@${userId}>\nСкидка: **${discount}%**`
      );
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
        await message.reply(
          "⌛ Срок твоей покупки истёк или не найден. Оформи новую через `!купить`."
        );
        return;
      }

      // 3) Попробуем завести HWID как access-токен (в my_table). Он должен быть уникален.
      try {
        await pool.query("INSERT INTO my_table (token, expires_at) VALUES ($1, $2)", [
          hwid,
          orderExpiresAt
        ]);
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

      await message.reply(
        `🔐 HWID \`${hwid}\` добавлен. Теперь доступ активен до **${orderExpiresAt.toLocaleString(
          "ru-RU"
        )}**.`
      );
      await sendLog(
        "🖥️ Добавлен HWID",
        `Пользователь: <@${userId}>\nHWID: \`${hwid}\`\nДействует до: ${orderExpiresAt.toLocaleString(
          "ru-RU"
        )}`
      );
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

      // --- Красивое сгруппированное отображение промокодов ---
      let promoList;

      if (promoRes.rowCount === 0) {
        promoList = "Промокоды пока отсутствуют 😔";
      } else {
        // группируем по скидке: discount -> { count, exampleId }
        const groups = new Map();

        for (const r of promoRes.rows) {
          const key = r.discount;
          if (!groups.has(key)) {
            groups.set(key, { count: 0, exampleId: r.id });
          }
          const g = groups.get(key);
          g.count += 1;
          if (r.id < g.exampleId) g.exampleId = r.id; // самый маленький ID как "пример"
        }

        // сортируем по скидке (по убыванию)
        const sorted = Array.from(groups.entries()).sort((a, b) => b[0] - a[0]);

        const lines = sorted.map(([discount, g]) => {
          const countText = g.count === 1 ? "1 шт" : `${g.count} шт`;
          return `🔹 **#${g.exampleId}** — ${discount}% (у вас ${countText})`;
        });

        let text = lines.join("\n");

        // на всякий случай режем, если вдруг поле > 1024 символов
        const MAX_FIELD = 1024;
        if (text.length > MAX_FIELD) {
          let acc = "";
          let usedGroups = 0;
          let usedCodes = 0;

          for (const [idx, [discount, g]] of sorted.entries()) {
            const line = `🔹 **#${g.exampleId}** — ${discount}% (у вас ${g.count} шт)`;
            if ((acc + (acc ? "\n" : "") + line).length > MAX_FIELD - 40) break; // чуть запас

            acc += (acc ? "\n" : "") + line;
            usedGroups++;
            usedCodes += g.count;
          }

          const totalCodes = promoRes.rowCount;
          const restCodes = totalCodes - usedCodes;
          const restGroups = sorted.length - usedGroups;

          if (restCodes > 0) {
            acc += `\n… и ещё ${restGroups} групп промокодов (${restCodes} шт всего)`;
          }

          text = acc;
        }

        promoList = text;
      }

      // --- HWID-часть без изменений ---
      const hwidList = hwidsRes.rowCount
        ? hwidsRes.rows
            .map(
              (r, i) =>
                `• **HWID #${i + 1}**: \`${r.hwid}\` (добавлен ${new Date(
                  r.created_at
                ).toLocaleDateString("ru-RU")})`
            )
            .join("\n")
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
              "🔐 Привязать HWID — `!add_hwid <HWID>`\n" +
              "⏱ Остаток подписки — `!срок`",
            inline: false
          }
        )
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      return;
    }

    // === !срок — остаток подписки по привязанному HWID
    if (cmd === "!срок") {
      const userId = message.author.id;

      // 1) есть ли у пользователя HWID
      const hwidsRes = await pool.query(
        "SELECT hwid FROM hwids WHERE user_id=$1 ORDER BY id ASC",
        [userId]
      );

      if (hwidsRes.rowCount === 0) {
        await message.reply(
          "ℹ️ У тебя ещё нет привязанного HWID.\n" +
            "Сначала оформи покупку `!купить`, затем привяжи устройство через:\n" +
            "`!add_hwid <HWID>`"
        );
        return;
      }

      const hwid = hwidsRes.rows[0].hwid;

      // 2) ищем срок действия в my_table
      const tokenRes = await pool.query(
        "SELECT expires_at FROM my_table WHERE token=$1",
        [hwid]
      );

      if (tokenRes.rowCount === 0 || !tokenRes.rows[0].expires_at) {
        await message.reply(
          "⚠️ Для твоего HWID нет данных о сроке действия.\n" +
            "Если ты уверен, что покупка была — напиши администратору."
        );
        return;
      }

      const expiresAt = new Date(tokenRes.rows[0].expires_at);
      const now = new Date();

      let statusText = "";
      let leftText = "";

      if (isNaN(expiresAt.getTime())) {
        statusText = "❓ Дата окончания некорректна, свяжись с админом.";
      } else if (expiresAt <= now) {
        statusText = `⛔ Подписка истекла **${expiresAt.toLocaleString("ru-RU")}**.`;
      } else {
        const diffMs = expiresAt.getTime() - now.getTime();
        const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
        const days = Math.floor(totalHours / 24);
        const hours = totalHours % 24;

        statusText = `✅ Подписка активна до **${expiresAt.toLocaleString("ru-RU")}**.`;
        leftText = `⏱ Осталось примерно: **${days} д. ${hours} ч.**`;
      }

      const embed = new EmbedBuilder()
        .setColor("#00bfa5")
        .setTitle("⏱ Остаток подписки")
        .setDescription(
          `**HWID:** \`${hwid}\`\n\n` + statusText + (leftText ? `\n${leftText}` : "")
        )
        .setFooter({ text: "HWID привязывается через !add_hwid после покупки" })
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

      await pool.query("UPDATE promos SET user_id=$1 WHERE id=$2", [
        targetUser.id,
        promoId
      ]);

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

    // === !создатьроль <название> — создать свою кейс-роль после выигрыша в кейсе ===
    if (cmd === "!создатьроль") {
      const guild = message.guild;
      if (!guild) {
        await message.reply("Эту команду можно использовать только на сервере.");
        return;
      }

      const key = `${guild.id}:${message.author.id}`;
      const session = customRoleSessions.get(key);
      if (!session) {
        await message.reply(
          "⛔ У тебя нет активного права на создание своей роли.\n" +
            "Попробуй выбить его из кейса командой `!кейс`."
        );
        return;
      }

      const roleName = args.join(" ").trim();
      if (!roleName) {
        await message.reply("⚙️ Формат: `!создатьроль <название роли>`");
        return;
      }
      if (roleName.length > 32) {
        await message.reply("⚠️ Название роли слишком длинное (максимум 32 символа).");
        return;
      }
      if (/@everyone|@here/.test(roleName)) {
        await message.reply("⚠️ Такое название использовать нельзя.");
        return;
      }

      try {
        const role = await guild.roles.create({
          name: roleName,
          mentionable: true,
          reason: `Кейс-роль для ${message.author.tag}`
        });

        const member = await guild.members.fetch(message.author.id);
        await member.roles.add(role);

        // сессию тратим
                // тратим один "заряд" на создание роли
        if (session.count && session.count > 1) {
          customRoleSessions.set(key, {
            guildId: session.guildId,
            count: session.count - 1
          });
        } else {
          customRoleSessions.delete(key);
        }

        // сохраним владельца роли в БД — чтобы можно было передавать
        await pool.query(
          `
          INSERT INTO case_roles (role_id, owner_id)
          VALUES ($1, $2)
          ON CONFLICT (role_id) DO UPDATE
            SET owner_id = EXCLUDED.owner_id
          `,
          [role.id, message.author.id]
        );

        await message.reply(
          `🎨 Роль **${role.name}** создана и выдана тебе!\n` +
            `Ты можешь передать её другому с помощью команды:\n` +
            "`!передатьроль @пользователь @роль`"
        );
      } catch (e) {
        console.error("create custom role error:", e);
        await message.reply(
          "⚠️ Не удалось создать или выдать роль. Проверь, что у бота есть права `Управлять ролями`."
        );
      }
      return;
    }

    // === !передатьроль @user @роль — передать свою кейс-роль другому человеку ===
    if (cmd === "!передатьроль") {
      const guild = message.guild;
      if (!guild) {
        await message.reply("Эту команду можно использовать только на сервере.");
        return;
      }

      const targetUser = message.mentions.users.first();
      const mentionedRoles = message.mentions.roles;
      const role = mentionedRoles.first();

      if (!targetUser || !role) {
        await message.reply(
          "⚙️ Формат: `!передатьроль @пользователь @роль`\n" +
            "Роль нужно указать упоминанием (например, `!передатьроль @User @МояРоль`)."
        );
        return;
      }

      if (targetUser.id === message.author.id) {
        await message.reply("😅 Нельзя передавать роль самому себе.");
        return;
      }

      // проверяем, что это именно кейс-роль и что отправитель — её владелец
      const res = await pool.query(
        "SELECT owner_id FROM case_roles WHERE role_id=$1",
        [role.id]
      );

      if (res.rowCount === 0) {
        await message.reply(
          "⛔ Эта роль не отмечена как кейс-роль. Передавать можно только роли, созданные через `!создатьроль`."
        );
        return;
      }

      if (res.rows[0].owner_id !== message.author.id) {
        await message.reply("⛔ Ты не являешься владельцем этой роли.");
        return;
      }

      try {
        const fromMember = await guild.members.fetch(message.author.id);
        const toMember = await guild.members.fetch(targetUser.id);

        if (fromMember.roles.cache.has(role.id)) {
          await fromMember.roles.remove(role);
        }
        await toMember.roles.add(role);

        await pool.query("UPDATE case_roles SET owner_id=$1 WHERE role_id=$2", [
          targetUser.id,
          role.id
        ]);

        await message.reply(
          `✅ Роль ${role} передана пользователю <@${targetUser.id}>.`
        );
      } catch (e) {
        console.error("transfer role error:", e);
        await message.reply(
          "⚠️ Не удалось передать роль. Проверь, что у бота достаточно прав для управления ролями."
        );
      }
      return;
    }

    // === Админ-команды ===
    if (message.author.id !== ADMIN_ID) return;

    if (cmd === "!стата") {
      // активные HWID (по сроку)
      const activeRes = await pool.query(
        "SELECT COUNT(*) AS cnt FROM my_table WHERE expires_at IS NULL OR expires_at > NOW();"
      );
      const activeCount = parseInt(activeRes.rows[0].cnt, 10) || 0;

      // все заказы
      const ordersRes = await pool.query(
        "SELECT COUNT(*) AS cnt, COALESCE(SUM(final_price),0) AS sum FROM orders;"
      );
      const totalOrders = parseInt(ordersRes.rows[0].cnt, 10) || 0;
      const totalRevenue = parseInt(ordersRes.rows[0].sum, 10) || 0;

      // за последние 30 дней
      const last30Res = await pool.query(
        `
        SELECT COUNT(*) AS cnt, COALESCE(SUM(final_price),0) AS sum
        FROM orders
        WHERE created_at >= NOW() - INTERVAL '30 days';
        `
      );
      const recentOrders = parseInt(last30Res.rows[0].cnt, 10) || 0;
      const recentRevenue = parseInt(last30Res.rows[0].sum, 10) || 0;

      // количество выданных промо
      const promoRes = await pool.query("SELECT COUNT(*) AS cnt FROM promos;");
      const promoCount = parseInt(promoRes.rows[0].cnt, 10) || 0;

      const embed = new EmbedBuilder()
        .setTitle("📊 Статистика проекта")
        .setColor("#ffca28")
        .addFields(
          {
            name: "👥 Активные HWID",
            value: `**${activeCount}** устройств с действующим доступом`,
            inline: false
          },
          {
            name: "💳 Все заказы",
            value: `Количество: **${totalOrders}**\nВыручка: **₽${totalRevenue}**`,
            inline: false
          },
          {
            name: "📆 За последние 30 дней",
            value: `Заказы: **${recentOrders}**\nВыручка: **₽${recentRevenue}**`,
            inline: false
          },
          {
            name: "🏷 Промокоды (всего выдано)",
            value: `**${promoCount}** промокодов в таблице`,
            inline: false
          }
        )
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      return;
    }

    if (cmd === "!выдатьпромо") {
      let target = message.mentions.users.first() || null;
      let discountIdx = 1;

      if (!target && args[0]) {
        try {
          target = await client.users.fetch(args[0]);
          discountIdx = 1;
        } catch {}
      }

      const discount = parseInt(args[discountIdx], 10);

      if (!target || !Number.isInteger(discount) || discount < 1 || discount > 100) {
        return message.reply(
          "⚙️ Формат: `!выдатьпромо @пользователь <1..100>` (например, `!выдатьпромо @User 25`)"
        );
      }

      await pool.query("INSERT INTO promos (user_id, discount) VALUES ($1, $2)", [
        target.id,
        discount
      ]);

      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ Промокод выдан")
            .setDescription(`Получатель: <@${target.id}>\nСкидка: **${discount}%**`)
            .setColor("#00c853")
        ]
      });

      try {
        await target.send(
          `🎁 Администратор выдал тебе промокод со скидкой **${discount}%**!`
        );
      } catch {}
      await sendLog(
        "🏷️ Выдача промокода (админ)",
        `Админ: <@${message.author.id}>\nКому: <@${target.id}>\nСкидка: **${discount}%**`
      );
      return;
    }

    if (cmd === "!выдать") {
      // админ вручную добавляет HWID в белый список (например, когда выдали доступ руками)
      const hwid = args[0];
      if (!hwid) return message.reply("⚙️ Формат: `!выдать <HWID>`");

      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1);

      try {
        await pool.query("INSERT INTO my_table(token, expires_at) VALUES($1,$2)", [
          hwid,
          expiresAt
        ]);
        await message.reply(
          `✅ HWID \`${hwid}\` добавлен. Истекает: ${expiresAt.toLocaleString("ru-RU")}`
        );
      } catch (err) {
        await message.reply("⚠️ Ошибка: возможно, такой HWID уже существует.");
      }
      return;
    }

    if (cmd === "!лист") {
      await removeExpiredTokens();
      const res = await pool.query(
        "SELECT token, expires_at FROM my_table ORDER BY id DESC"
      );
      const list = res.rows.length
        ? res.rows
            .map(
              (r) =>
                `• HWID \`${r.token}\` — истекает ${new Date(
                  r.expires_at
                ).toLocaleString("ru-RU")}`
            )
            .join("\n")
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

    if (cmd === "!выдатькоины") {
      const target = message.mentions.users.first();
      const amount = parseInt(args[1] || args[0], 10);

      if (!target || !Number.isInteger(amount)) {
        return message.reply("⚙️ Формат: `!выдатькоины @пользователь <кол-во>`");
      }

      await addCoins(target.id, amount);
      const bal = await getBalance(target.id);

      await message.reply(
        `✅ Пользователю <@${target.id}> начислено **${amount}** монет.\n` +
          `Новый баланс: **${bal}**.`
      );
      return;
    }
  } catch (err) {
    console.error("Ошибка команды:", err);
    await message.reply("⚠️ Ошибка при выполнении команды.");
  }
});

// === Инвайты и монеты за приглашения ===
async function cacheGuildInvites() {
  try {
    const guilds = await client.guilds.fetch();
    for (const [guildId] of guilds) {
      const guild = await client.guilds.fetch(guildId);
      const invites = await guild.invites.fetch();
      const map = new Map();
      invites.forEach((inv) => map.set(inv.code, inv.uses || 0));
      invitesCache.set(guild.id, map);
    }
    console.log("✅ Инвайты закешированы");
  } catch (e) {
    console.error("Ошибка cacheGuildInvites:", e);
  }
}

client.on("inviteCreate", async (invite) => {
  try {
    const guild = invite.guild;
    if (!guild) return;
    let map = invitesCache.get(guild.id);
    if (!map) map = new Map();
    map.set(invite.code, invite.uses || 0);
    invitesCache.set(guild.id, map);
  } catch (e) {
    console.error("inviteCreate error:", e);
  }
});

client.on("guildMemberAdd", async (member) => {
  try {
    const guild = member.guild;
    const prevInvites = invitesCache.get(guild.id) || new Map();

    const newInvites = await guild.invites.fetch();
    let usedInvite = null;

    newInvites.forEach((inv) => {
      const prev = prevInvites.get(inv.code) || 0;
      if ((inv.uses || 0) > prev) {
        usedInvite = inv;
      }
    });

    const map = new Map();
    newInvites.forEach((inv) => map.set(inv.code, inv.uses || 0));
    invitesCache.set(guild.id, map);

    if (!usedInvite || !usedInvite.inviter) return;

    const inviter = usedInvite.inviter;
    await addCoins(inviter.id, COINS_PER_INVITE);

    try {
      await inviter.send(
        `👥 За приглашение **${member.user.tag}** тебе начислено **${COINS_PER_INVITE}** монет.`
      );
    } catch {}
  } catch (e) {
    console.error("guildMemberAdd error:", e);
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
      return interaction.reply({
        content: "⚠️ Сессия устарела. Набери `!купить` ещё раз.",
        ephemeral: true
      });
    }
    if (interaction.user.id !== session.userId || interaction.user.id !== who) {
      return interaction.reply({
        content: "⛔ Эта панель не для тебя.",
        ephemeral: true
      });
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
          return interaction.reply({
            content: "🔒 Промокод уже выбран — изменить нельзя.",
            ephemeral: true
          });
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
          return interaction.reply({
            content: "⚠️ Этот промокод недоступен или уже использован.",
            ephemeral: true
          });
        }
        session.promoId = id;
        session.promoDiscount = Math.min(
          100,
          Math.max(0, parseInt(del.rows[0].discount, 10) || 0)
        );
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
        const expiresAt = new Date(
          Date.now() + PRODUCT.durationDays * 24 * 60 * 60 * 1000
        );

        const coinsBonus = COINS_PER_PURCHASE;
        if (coinsBonus > 0) {
          await addCoins(session.userId, coinsBonus);
        }

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
                {
                  name: "Товар",
                  value: `${PRODUCT.name} (${PRODUCT.durationDays} дней)`,
                  inline: true
                },
                { name: "Цена", value: `₽${base}`, inline: true },
                { name: "Скидка", value: `${discount}%`, inline: true },
                { name: "К оплате", value: `**₽${final}**`, inline: true },
                { name: "ID заказа", value: `#${orderId}`, inline: true },
                {
                  name: "Действует до",
                  value: expiresAt.toLocaleString("ru-RU"),
                  inline: true
                },
                {
                  name: "Бонус монет",
                  value: `${coinsBonus}`,
                  inline: true
                }
              )
              .setFooter({
                text: "Теперь введи: !add_hwid <HWID> (будет добавлен в белый список)"
              })
          ],
          components: []
        });

        try {
          const user = await client.users.fetch(session.userId);
          await user.send(
            `✅ Покупка оформлена. Срок доступа до **${expiresAt.toLocaleString(
              "ru-RU"
            )}**.\n` +
              `Теперь привяжи устройство:\n` +
              `**!add_hwid <HWID>**\n\n` +
              `В белый список попадёт именно указанный тобой HWID.\n\n` +
              `💰 За покупку тебе начислено **${coinsBonus}** монет.`
          );
        } catch {}

        await sendLog(
          "💳 Покупка",
          `Пользователь: <@${session.userId}>\nТовар: **${PRODUCT.name}**\nЦена: ₽${base}\nСкидка: ${discount}%\nИтого: **₽${final}**\nOrderID: #${orderId}\nИстекает: ${expiresAt.toLocaleString(
            "ru-RU"
          )}\nМонеты за покупку: ${coinsBonus}`
        );

        buySessions.delete(messageId);
        return;
      }
    }
  } catch (err) {
    console.error("interactionCreate error:", err);
    try {
      if (interaction.isRepliable()) {
        await interaction.reply({
          content: "⚠️ Ошибка при обработке действия.",
          ephemeral: true
        });
      }
    } catch {}
  }
});

// === Запуск ===
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  await initDB();
  await removeExpiredTokens();
  await cacheGuildInvites();
});

// === Самопинг (Render keep-alive) ===
setInterval(() => {
  fetch("https://adadadadad-97sj.onrender.com/check/1").catch(() => {});
}, 5 * 60 * 1000);

app.listen(process.env.PORT || 3000, () => console.log("✅ Server ready"));
client.login(BOT_TOKEN);
