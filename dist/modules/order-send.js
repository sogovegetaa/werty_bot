import { bot } from "../index.js";
import { supabase } from "../api.js";
import { parsePairAndAmount } from "./rate.js";
import { launchPuppeteer } from "../utils/puppeteer.js";
export const orderSendModule = async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const text = msg.text?.trim() || "";
    try {
        const { data: user, error: userError } = await supabase
            .from("user")
            .select("id")
            .eq("telegram_id", telegramId)
            .single();
        if (userError) {
            console.error("Error fetching user:", userError);
            return;
        }
        if (!user) {
            await bot.sendMessage(chatId, "❌ Сначала зарегистрируйся через /start.");
            return;
        }
        const idFirstMatch = text.match(/^\/отпр\s+(#?\d+)\s+(.+)$/i);
        let orderId = null;
        let currencyText = null;
        if (idFirstMatch) {
            orderId = Number(idFirstMatch[1].replace("#", ""));
            const restAfterId = idFirstMatch[2];
            const testCurrencyText = `/курс ${restAfterId}`;
            const parsedTest = parsePairAndAmount(testCurrencyText);
            if (parsedTest && parsedTest.base && parsedTest.quote) {
                currencyText = testCurrencyText;
            }
        }
        else {
            const restMatch = text.match(/^\/отпр\s+(.+)$/i);
            if (restMatch) {
                const rest = restMatch[1];
                if (!rest.match(/^\d/)) {
                    const testCurrencyText = `/курс ${rest}`;
                    const parsedTest = parsePairAndAmount(testCurrencyText);
                    if (parsedTest && parsedTest.base && parsedTest.quote) {
                        currencyText = testCurrencyText;
                    }
                }
            }
        }
        if (currencyText) {
            const parsed = parsePairAndAmount(currencyText);
            if (parsed && parsed.base && parsed.quote) {
                const { base, quote, amount, divisor } = parsed;
                const url = `https://www.xe.com/currencyconverter/convert/?Amount=${encodeURIComponent(amount)}&From=${encodeURIComponent(base)}&To=${encodeURIComponent(quote)}`;
                try {
                    const browser = await launchPuppeteer();
                    const page = await browser.newPage();
                    await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
                    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
                    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
                    await page.waitForSelector('form[data-hs-cf-bound]', { timeout: 10000 });
                    await page.waitForTimeout(1500);
                    const convertedText = await page.evaluate(() => {
                        const input = document.querySelector('fieldset:last-of-type input[aria-label="Receiving amount"]');
                        return input?.value?.trim() || null;
                    });
                    await browser.close();
                    if (convertedText) {
                        const cleaned = convertedText.replace(/\s+/g, "");
                        const numberMatch = cleaned.match(/^([\d,]+\.?\d*)/);
                        if (numberMatch) {
                            const convertedValueStr = numberMatch[1].replace(/,/g, "");
                            const convertedValueBeforeDivisor = parseFloat(convertedValueStr);
                            let convertedValueNum = convertedValueBeforeDivisor;
                            if (divisor && divisor > 0) {
                                convertedValueNum = convertedValueBeforeDivisor / divisor;
                            }
                            let order = null;
                            if (orderId) {
                                const { data: byId } = await supabase
                                    .from("order")
                                    .select("*")
                                    .eq("id", orderId)
                                    .eq("chat_id", chatId)
                                    .single();
                                if (byId)
                                    order = byId;
                            }
                            else if (msg.reply_to_message) {
                                const repliedMsgId = msg.reply_to_message.message_id;
                                const { data: byReply } = await supabase
                                    .from("order")
                                    .select("*")
                                    .eq("chat_id", chatId)
                                    .eq("message_id", repliedMsgId)
                                    .single();
                                if (byReply)
                                    order = byReply;
                            }
                            else {
                                const { data: lastOrder } = await supabase
                                    .from("order")
                                    .select("*")
                                    .eq("user_id", user.id)
                                    .eq("chat_id", chatId)
                                    .in("status", ["created", "partial"])
                                    .order("created_at", { ascending: false })
                                    .limit(1)
                                    .single();
                                if (lastOrder)
                                    order = lastOrder;
                            }
                            if (!order) {
                                await bot.sendMessage(chatId, `❌ Заявка не найдена. Результат конвертации: ${convertedValueNum.toFixed(2)} ${quote}.`);
                                return;
                            }
                            const amount = convertedValueNum;
                            const sent_usdt = Number(order.sent_usdt || 0) + amount;
                            const remaining_usdt = Math.max(Number(order.usdt_amount || 0) - sent_usdt, 0);
                            const newStatus = remaining_usdt <= 0 ? "done" : "partial";
                            const { error: updateError } = await supabase
                                .from("order")
                                .update({
                                sent_usdt,
                                remaining_usdt,
                                status: newStatus,
                                updated_at: new Date().toISOString(),
                            })
                                .eq("id", order.id)
                                .eq("chat_id", chatId);
                            if (updateError)
                                throw updateError;
                            const getStr = Number(order.rub_get || 0).toLocaleString("ru-RU");
                            const sentStr = Number(sent_usdt).toLocaleString("ru-RU", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                            });
                            const remainingStr = Number(remaining_usdt).toLocaleString("ru-RU", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                            });
                            let conversionInfo = `${amount} ${base} → ${convertedValueBeforeDivisor.toFixed(2)} ${quote}`;
                            if (divisor && divisor > 0) {
                                conversionInfo = `${amount} ${base} → ${convertedValueBeforeDivisor.toFixed(2)} ${quote} / ${divisor} = ${convertedValueNum.toFixed(2)}`;
                            }
                            await bot.sendMessage(chatId, `✅ Отправлено: <code>${convertedValueNum.toFixed(2)}</code> USDT (${conversionInfo})\n` +
                                `Заявка #${order.id}: <code>${getStr}</code> руб\n` +
                                `Отправлено: <code>${sentStr}</code> USDT\n` +
                                `Осталось: <code>${remainingStr}</code> USDT\n` +
                                `Статус: <b>${newStatus}</b>`, { parse_mode: "HTML" });
                            return;
                        }
                    }
                    await bot.sendMessage(chatId, `❌ Не удалось получить данные с XE.com.`);
                    return;
                }
                catch (e) {
                    console.error("/отпр currency error:", e);
                    await bot.sendMessage(chatId, "⚠️ Ошибка при конвертации валюты.");
                    return;
                }
            }
        }
        const replyMatch = text.match(/^\/отпр\s+([\d\s.,]+)/i);
        const idMatch = text.match(/^\/отпр\s+(#?\d+)\s+([\d\s.,]+)/i);
        let order = null;
        let amount = null;
        if (msg.reply_to_message && replyMatch) {
            const repliedMsgId = msg.reply_to_message.message_id;
            const { data: byReply } = await supabase
                .from("order")
                .select("*")
                .eq("chat_id", chatId)
                .eq("message_id", repliedMsgId)
                .single();
            if (byReply)
                order = byReply;
            amount = parseFloat(replyMatch[1].replace(/\s+/g, "").replace(",", "."));
        }
        else if (idMatch) {
            const orderId = Number(idMatch[1].replace("#", ""));
            const { data: byId } = await supabase
                .from("order")
                .select("*")
                .eq("id", orderId)
                .eq("chat_id", chatId)
                .single();
            if (byId)
                order = byId;
            amount = parseFloat(idMatch[2].replace(/\s+/g, "").replace(",", "."));
        }
        else {
            await bot.sendMessage(chatId, "⚙️ Формат: /отпр <id> <сумма> или ответом на карточку: /отпр <сумма>\nИли: /отпр eurusd 10000/1,015\nПримеры: /отпр 23 200000, (reply) /отпр 200000, /отпр eurusd 10000/1,015");
            return;
        }
        if (!order) {
            await bot.sendMessage(chatId, "❌ Заявка не найдена. Ответьте на карточку или укажите ID.");
            return;
        }
        if (amount === null || isNaN(amount) || amount <= 0) {
            await bot.sendMessage(chatId, "❌ Неверная сумма.");
            return;
        }
        const sent_usdt = Number(order.sent_usdt || 0) + amount;
        const remaining_usdt = Math.max(Number(order.usdt_amount || 0) - sent_usdt, 0);
        const newStatus = remaining_usdt <= 0 ? "done" : "partial";
        const { error: updateError } = await supabase
            .from("order")
            .update({
            sent_usdt,
            remaining_usdt,
            status: newStatus,
            updated_at: new Date().toISOString(),
        })
            .eq("id", order.id)
            .eq("chat_id", chatId);
        if (updateError)
            throw updateError;
        let messageText = `💰 Отправлено: <code>${amount.toLocaleString("ru-RU")}</code> USDT\n\n` +
            `Заявка: <b>${order.id}</b>\n` +
            `Всего по заявке: <code>${order.usdt_amount.toLocaleString("ru-RU")}</code> USDT\n` +
            `Уже отправлено: <code>${sent_usdt.toLocaleString("ru-RU")}</code> USDT\n` +
            `Осталось: <code>${remaining_usdt.toLocaleString("ru-RU")}</code> USDT\n\n`;
        if (newStatus === "done") {
            messageText += "✅ Заявка полностью выполнена!";
        }
        else {
            messageText += "🕓 Можно отправить оставшуюся сумму позже.";
        }
        await bot.sendMessage(chatId, messageText, { parse_mode: "HTML" });
    }
    catch (err) {
        console.error("Ошибка /отпр:", err);
        bot.sendMessage(chatId, "⚠️ Ошибка при обновлении заявки.");
    }
};
