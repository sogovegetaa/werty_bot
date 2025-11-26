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

    // Проверяем существование счета в этом чате (общий для всех пользователей)
    const { data: acc } = await supabase
      .from("wallet")
      .select("id, balance, precision")
      .eq("chat_id", chatId)
      .eq("code", code)
      .single();

    if (!acc) {
      await bot.sendMessage(chatId, `❌ Счёт ${code} не найден.`);
      return;
    }

    // Проверяем баланс из транзакций всех пользователей в этом чате
    const { data: transactions } = await supabase
      .from("wallet_tx")
      .select("amount")
      .eq("code", code)
      .eq("chat_id", chatId);

    const totalBalance = (transactions || []).reduce(
      (sum, tx) => sum + Number(tx.amount || 0),
      0
    );

    if (totalBalance !== 0) {
      await bot.sendMessage(
        chatId,
        `❌ Нельзя удалить счёт с ненулевым балансом. Текущий баланс: <code>${Number(
          totalBalance
        ).toFixed(acc.precision || 2)}</code> ${code}`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // Удаляем все транзакции этого счета всех пользователей в текущем чате
    const { error: txError } = await supabase
      .from("wallet_tx")
      .delete()
      .eq("code", code)
      .eq("chat_id", chatId);
    if (txError) throw txError;

    // Удаляем сам счет
    const { error } = await supabase.from("wallet").delete().eq("id", acc.id);
    if (error) throw error;

    await bot.sendMessage(chatId, `🗑️ Счёт ${code} удалён.`);
  } catch (e) {
    console.error("/удали error:", e);
    await bot.sendMessage(chatId, "⚠️ Ошибка при удалении счёта.");
  }
};


