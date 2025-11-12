import { Message } from "node-telegram-bot-api";
import { bot } from "../index.js";
import { supabase } from "../api.js";
import { formatWithApostrophe } from "../utils/format.js";

export const balanceShowModule = async (msg: Message): Promise<void> => {
  const chatId = msg.chat.id;
  const telegramId = msg.from!.id;
  const text = msg.text?.trim() || "";
  const m = text.match(/^\/дай(?:\s+([\p{L}A-Za-z]{2,8}))?$/u);
  const requestedCode = m && m[1] ? m[1].toLowerCase() : undefined;

  try {
    const { data: user, error: userError } = await supabase
      .from("user")
      .select("id, username")
      .eq("telegram_id", telegramId)
      .single();

    if (userError || !user) {
      await bot.sendMessage(
        chatId,
        "❌ Сначала напиши /start, чтобы зарегистрироваться."
      );
      return;
    }

    // Получаем все транзакции пользователя в этом чате
    const { data: transactions } = await supabase
      .from("wallet_tx")
      .select("code, amount")
      .eq("user_id", user.id)
      .eq("chat_id", chatId);

    // Считаем баланс для каждого счета из транзакций этого чата
    const balancesByCode: Record<string, number> = {};
    if (transactions) {
      for (const tx of transactions) {
        const code = tx.code.toLowerCase();
        balancesByCode[code] = (balancesByCode[code] || 0) + Number(tx.amount || 0);
      }
    }

    // Получаем настройки счетов (precision) из таблицы wallet
    const { data: walletSettings } = await supabase
      .from("wallet")
      .select("code, precision")
      .eq("user_id", user.id);

    // Создаем массив счетов с балансами и precision
    const accounts: Array<{ code: string; balance: number; precision: number }> = [];
    
    // Добавляем счета, которые есть в транзакциях
    for (const code of Object.keys(balancesByCode)) {
      const setting = walletSettings?.find((w) => w.code.toLowerCase() === code);
      accounts.push({
        code,
        balance: balancesByCode[code],
        precision: setting?.precision || 2,
      });
    }

    // Если нет счетов, добавляем дефолтный UAH с балансом 0
    if (accounts.length === 0) {
      const defaultSetting = walletSettings?.find((w) => w.code.toLowerCase() === "uah");
      accounts.push({
        code: "uah",
        balance: 0,
        precision: defaultSetting?.precision || 2,
      });
    }

    // Сортируем по коду
    accounts.sort((a, b) => a.code.localeCompare(b.code));

    const lines = accounts.map((a) => {
      const formatted = formatWithApostrophe(Number(a.balance || 0), a.precision || 2);
      return ` <code>${formatted}</code> ${a.code}`;
    });

    const message =
      `Средств на руках у неизвестного:\n\n` +
      (lines.length ? lines.join("\n") : "   0.00 uah") +
      `\n\nЕсли нужна выписка по одному счёту: напишите /дай &lt;код&gt; и нажмите нужную кнопку.`;

    // Кнопки: по умолчанию только общая XLS. Если указан код — одна кнопка для этого счёта
    let buttons: any[] = [[{ text: "Полная выписка", callback_data: "report_xls" }]];
    if (requestedCode && accounts) {
      const target = accounts.find((a) => a.code.toLowerCase() === requestedCode);
      if (target) {
        buttons = [[{ text: `XLS: ${target.code}`, callback_data: `report_xls:code:${target.code}` }]];
      }
    }

    await bot.sendMessage(chatId, message, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  } catch (err) {
    console.error("Ошибка в /дай:", err);
    bot.sendMessage(chatId, "⚠️ Ошибка при получении данных.");
  }
};
