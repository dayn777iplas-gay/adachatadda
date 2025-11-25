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
