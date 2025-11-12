import { type Message } from "node-telegram-bot-api";
import { bot } from "../index.js";
import { supabase } from "../api.js";

export const walletRemoveModule = async (msg: Message): Promise<void> => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() || "";

  const match = text.match(/^\/удали\s+([\p{L}]{2,8})$/iu);
  if (!match) {
    await bot.sendMessage(chatId, "⚙️ Формат: /удали <код_счёта>\nПример: /удали usd");
    return;
  }

  const code = match[1].toLowerCase();

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

    const { data: acc } = await supabase
      .from("wallet")
      .select("id, balance, precision")
      .eq("user_id", user.id)
      .eq("code", code)
      .single();

    if (!acc) {
      await bot.sendMessage(chatId, `❌ Счёт ${code} не найден.`);
      return;
    }

    if (Number(acc.balance || 0) !== 0) {
      await bot.sendMessage(
        chatId,
        `❌ Нельзя удалить счёт с ненулевым балансом. Текущий баланс: <code>${Number(
          acc.balance || 0
        ).toFixed(acc.precision || 2)}</code> ${code}`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const { error } = await supabase.from("wallet").delete().eq("id", acc.id);
    if (error) throw error;

    await bot.sendMessage(chatId, `🗑️ Счёт ${code} удалён.`);
  } catch (e) {
    console.error("/удали error:", e);
    await bot.sendMessage(chatId, "⚠️ Ошибка при удалении счёта.");
  }
};


