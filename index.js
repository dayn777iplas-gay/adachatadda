const { Client, GatewayIntentBits } = require("discord.js");
const { Pool } = require("pg");

const client = new Client({ 
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// авто-создание таблицы
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tokens (
      user_id TEXT PRIMARY KEY,
      token TEXT NOT NULL
    )
  `);
})();

client.on("messageCreate", async (message) => {
  if (!message.content.startsWith("!")) return;

  // только ты (админ) можешь работать с токенами
  if (message.author.id !== "832278157066240040") {
    return message.reply("❌ Ты не админ!");
  }

  const args = message.content.split(" ");
  const command = args[0].toLowerCase();

  // команда для добавления токена
  if (command === "!settoken") {
    const token = args[1];
    if (!token) return message.reply("⚠️ Напиши токен после команды");

    await pool.query(
      "INSERT INTO tokens(user_id, token) VALUES($1, $2) ON CONFLICT (user_id) DO UPDATE SET token=$2",
      [message.author.id, token]
    );

    return message.reply("✅ Токен сохранён!");
  }

  // команда для удаления токена
  if (command === "!deltoken") {
    await pool.query("DELETE FROM tokens WHERE user_id = $1", [message.author.id]);

    return message.reply("🗑️ Токен удалён!");
  }

  // команда для просмотра сохранённого токена
  if (command === "!mytoken") {
    const res = await pool.query("SELECT token FROM tokens WHERE user_id = $1", [message.author.id]);
    if (res.rows.length === 0) {
      return message.reply("⚠️ У тебя нет сохранённого токена.");
    }
    return message.reply(`🔑 Твой токен: \`${res.rows[0].token}\``);
  }
});

client.login(BOT_TOKEN);
