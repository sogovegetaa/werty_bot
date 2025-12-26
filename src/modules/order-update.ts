import { Message } from "node-telegram-bot-api";
import { bot } from "../index.js";
import { supabase } from "../api.js";
export const updateOrderModule = async (msg: Message): Promise<void> => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim() || "";
    const { data: currentUser, error: userErr } = await supabase
        .from("user")
        .select("id, role")
        .eq("telegram_id", msg.from!.id)
        .single();
    if (userErr) {
        console.error("Error fetching user for /изм:", userErr);
        await bot.sendMessage(chatId, "⚠️ Ошибка проверки прав пользователя.");
        return;
    }
    if (!currentUser || currentUser.role !== "admin") {
        await bot.sendMessage(chatId, "⛔ Команда доступна только администраторам.");
        return;
    }
    const newFmt = text.match(/^\/изм\s+(\d+)\s+([\d\s.,]+)\s+от\s+([\d\s.,]+)\/([\d.,]+)/i);
    if (!newFmt) {
        await bot.sendMessage(chatId, "⚙️ Форматы:\n• /изм <id> <руб_получаем> от <руб_отдаем>/<курс>\n  пример: /изм 23 1000 от 1000/2\n• /изм <id> поле=значение [поле=значение ...]\n  пример: /изм 21 rub_get=44000000 rate=81.8", { parse_mode: "HTML" });
        return;
    }
    const orderId = Number(newFmt![1]);
    try {
        const { data: oldOrder, error: oldOrderError } = await supabase
            .from("order")
            .select("*")
            .eq("id", orderId)
            .eq("chat_id", chatId)
            .single();
        if (oldOrderError) {
            console.error("Error fetching old order:", oldOrderError);
            return;
        }
        if (!oldOrder) {
            await bot.sendMessage(chatId, `❌ Заявка #${orderId} не найдена.`);
            return;
        }
        const updates: Record<string, any> = {};
        if (newFmt) {
            const rubGet = parseFloat(newFmt[2].replace(/\s+/g, "").replace(",", "."));
            const rubGive = parseFloat(newFmt[3].replace(/\s+/g, "").replace(",", "."));
            const rate = parseFloat(newFmt[4].replace(",", "."));
            if ([rubGet, rubGive, rate].some((n) => Number.isNaN(n) || n <= 0)) {
                await bot.sendMessage(chatId, "❌ Проверьте числа: /изм <id> <руб_получаем> от <руб_отдаем>/<курс>", { parse_mode: "HTML" });
                return;
            }
            const usdtAmount = +(rubGive / rate).toFixed(2);
            updates.rub_get = rubGet;
            updates.rub_give = rubGive;
            updates.rate = rate;
            updates.usdt_amount = usdtAmount;
        }
        if (Object.keys(updates).length === 0) {
            await bot.sendMessage(chatId, "⚠️ Не указано ни одно корректное поле.");
            return;
        }
        const { data: newOrder, error } = await supabase
            .from("order")
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq("id", orderId)
            .eq("chat_id", chatId)
            .select("*")
            .single();
        if (error)
            throw error;
        const FIELD_LABELS: Record<string, string> = {
            rub_get: "Получаем",
            rub_give: "Отдаем",
            rate: "Курс",
            usdt_amount: "USDT",
        };
        const formatFieldLabel = (key: string): string => {
            if (FIELD_LABELS[key])
                return FIELD_LABELS[key];
            return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        };
        let diffText = "";
        for (const key of Object.keys(updates)) {
            const oldVal = oldOrder[key];
            const newVal = newOrder[key];
            if (oldVal !== newVal) {
                const label = formatFieldLabel(key);
                diffText += `• <b>${label}</b>: <code>${oldVal}</code> → <code>${newVal}</code>\n`;
            }
        }
        if (newOrder.chat_id && newOrder.message_id) {
            const messageText = `Заявка: <b><code>${newOrder.id}</code></b>\n` +
                `----\n` +
                `Получаем: <code>${newOrder.rub_get.toLocaleString("ru-RU")}</code> руб\n` +
                `Курс: <code>${newOrder.rate}</code>\n` +
                `Отдаем: <code>${newOrder.usdt_amount.toLocaleString("ru-RU")}</code> юсдт\n` +
                `Изм: <code>${new Date().toLocaleTimeString("ru-RU", {
                    timeZone: "Asia/Almaty",
                    hour12: false,
                    day: "2-digit",
                    month: "short",
                })}</code>`;
            await bot.editMessageText(messageText, {
                chat_id: newOrder.chat_id,
                message_id: newOrder.message_id,
                parse_mode: "HTML",
            });
        }
        await bot.sendMessage(chatId, `✅ Заявка #${orderId} обновлена.\n${diffText || "Без изменений."}`, { parse_mode: "HTML" });
    }
    catch (error) {
        console.error("Ошибка /изм:", error);
        bot.sendMessage(chatId, "⚠️ Ошибка при изменении заявки.");
    }
};
