import { type Message } from "node-telegram-bot-api";
import { bot } from "../index.js";
import { supabase } from "../api.js";

export const walletAddModule = async (msg: Message): Promise<void> => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() || "";

  const match = text.match(/^\/добавь\s+([\p{L}]{2,8})(?:\s+(\d))?$/iu);
  if (!match) {
    await bot.sendMessage(
      chatId,
      "⚙️ Формат: /добавь <код_счёта> [точность 0-8]\nПример: /добавь usd 2"
    );
    return;
  }

  const code = match[1].toLowerCase();
  const precision = match[2] ? Math.min(8, Math.max(0, Number(match[2]))) : 2;

  try {
    const { data: user } = await supabase
      .from("user")
      .select("id")
      .eq("telegram_id", msg.from!.id)
      .single();
    if (!user) {
      await bot.sendMessage(chatId, "❌ Сначала зарегистрируйся через /start.");
      return;
    }

    // Проверяем существование счета в этом чате (общий для всех пользователей)
    const { data: existing } = await supabase
      .from("wallet")
      .select("id, precision")
      .eq("chat_id", chatId)
      .eq("code", code)
      .single();

    if (existing) {
      if (match[2]) {
        await supabase.from("wallet").update({ precision }).eq("id", existing.id);
        await bot.sendMessage(
          chatId,
          `Точность обновлена. Теперь <code>${precision}</code> разр. после запятой.`,
          { parse_mode: "HTML" }
        );
      } else {
        await bot.sendMessage(
          chatId,
          `Счёт уже есть. Точность: <code>${existing.precision}</code>.`,
          { parse_mode: "HTML" }
        );
      }
      return;
    }

    // Создаем счет для всего чата (без user_id, общий для всех)
    const { error } = await supabase
      .from("wallet")
      .insert({ chat_id: chatId, code, precision, balance: 0 });
    if (error) throw error;

    await bot.sendMessage(
      chatId,
      `Счёт добавлен. Установлена точность <code>${precision}</code> разряда${precision === 1 ? "" : ""} после запятой.`,
      { parse_mode: "HTML" }
    );
  } catch (e) {
    console.error("/добавь error:", e);
    await bot.sendMessage(chatId, "⚠️ Ошибка при добавлении счёта.");
  }
};


