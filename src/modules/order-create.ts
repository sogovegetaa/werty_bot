import { type Message } from "node-telegram-bot-api";
import { bot } from "../index.js";
import { supabase } from "../api.js";

export const createOrderModule = async (msg: Message): Promise<void> => {
  const chatId = msg.chat.id;
  const rawText = msg.text || "";
  const text = rawText.replace(/^\/пр\s+/i, "").trim();

  try {
    const parts = text.match(/^([\d\s.,]+)\s+от\s+([\d\s.,]+)\/([\d.,]+)/);
    if (!parts) {
      await bot.sendMessage(
        chatId,
        "Формат: /пр <code>{руб_получаем}</code> от <code>{руб_отдаем}</code>/<code>{курс}</code>",
        { parse_mode: "HTML" }
      );
      return;
    }

    const rubGet = parseFloat(parts[1].replace(",", "."));
    const rubGive = parseFloat(parts[2].replace(",", "."));
    const rate = parseFloat(parts[3].replace(",", "."));
    const usdtAmount = +(rubGive / rate).toFixed(2);

    const { data: user } = await supabase
      .from("user")
      .select("*")
      .eq("telegram_id", msg.from.id)
      .single();

    if (!user) {
      await bot.sendMessage(
        chatId,
        "❌ Сначала напиши /start, чтобы зарегистрироваться."
      );
      return;
    }

    const { data: order, error: orderError } = await supabase
      .from("order")
      .insert({
        user_id: user.id,
        rub_get: rubGet,
        rub_give: rubGive,
        rate,
        usdt_amount: usdtAmount,
        sent_usdt: 0,
        remaining_usdt: usdtAmount,
        status: "created",
      })
      .select("*")
      .single();

    if (orderError) {
      console.error("Error creating order:", orderError);
      await bot.sendMessage(chatId, "Ошибка при создании заявки.");
      return;
    }

    const messageText =
      `Заявка: <b><code>${order?.id}</code></b>\n` +
      `----\n` +
      `Получаем: <code>${rubGet.toLocaleString("ru-RU")}</code> руб\n` +
      `Курс: <code>${rate}</code>\n` +
      `Отдаем: <code>${usdtAmount.toLocaleString("ru-RU")}</code> юсдт\n` +
      `Изм: ${new Date(order?.created_at).toLocaleString("ru-RU", {
        timeZone: "Asia/Almaty",
        hour12: false,
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}`;

    const sentMessage = await bot.sendMessage(chatId, messageText, {
      parse_mode: "HTML",
    });

    await supabase
      .from("order")
      .update({
        chat_id: chatId,
        message_id: sentMessage.message_id,
      })
      .eq("id", order.id);
  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, "Произошла ошибка при обработке команды.");
  }
};
