import { bot } from "../index.js";
import { supabase } from "../api.js";
import { formatWithApostrophe, evaluateMathExpression, parseFlexibleNumber } from "../utils/format.js";
import { parsePairAndAmount } from "./rate.js";
import puppeteer from "puppeteer";
export const walletAdjustModule = async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim() || "";
    const m = text.match(/^\/([\p{L}]{2,8})\s+(.+)/u);
    if (!m)
        return;
    const code = m[1].toLowerCase();
    const restOfText = m[2];
    // Проверяем, не является ли это запросом на конвертацию валюты
    // Формат: /usd eurusd 10000/1,015
    // Проверяем, не начинается ли с числа или знака (тогда это обычное выражение)
    let conversionResult = null;
    let conversionMessage = null;
    if (!restOfText.match(/^[\d+\-]/)) {
        const pairText = `/курс ${restOfText}`;
        const parsed = parsePairAndAmount(pairText);
        if (parsed && parsed.base && parsed.quote) {
            // Это запрос на конвертацию валюты
            const { base, quote, amount, divisor } = parsed;
            const url = `https://www.xe.com/currencyconverter/convert/?Amount=${encodeURIComponent(amount)}&From=${encodeURIComponent(base)}&To=${encodeURIComponent(quote)}`;
            try {
                const browser = await puppeteer.launch({ headless: true });
                const page = await browser.newPage();
                await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
                await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
                await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
                await page.waitForSelector('div[data-testid="conversion"]', { timeout: 10000 });
                await page.waitForTimeout(1500);
                const convertedText = await page.evaluate(() => {
                    const element = document.querySelector("p.sc-c5062ab2-1.jKDFIr");
                    return element?.textContent?.trim() || null;
                });
                await browser.close();
                if (convertedText) {
                    const cleaned = convertedText.replace(/\s+/g, "");
                    const numberMatch = cleaned.match(/^([\d,]+\.?\d*)/);
                    if (numberMatch) {
                        const convertedValueStr = numberMatch[1].replace(/,/g, "");
                        const convertedValueNum = parseFloat(convertedValueStr);
                        conversionResult = convertedValueNum;
                        conversionMessage = `${amount} ${base} → ${quote} = ${convertedValueNum.toFixed(2)}`;
                        if (divisor && divisor > 0) {
                            conversionResult = convertedValueNum / divisor;
                            conversionMessage += `\n${convertedValueNum.toFixed(2)} / ${divisor} = ${conversionResult.toFixed(2)}`;
                        }
                    }
                }
                if (conversionResult === null) {
                    await bot.sendMessage(chatId, `❌ Не удалось получить данные с XE.com.`);
                    return;
                }
            }
            catch (e) {
                console.error(`/${code} currency error:`, e);
                await bot.sendMessage(chatId, "⚠️ Ошибка при конвертации валюты.");
                return;
            }
        }
    }
    // Определяем сумму для добавления к балансу
    let num;
    if (conversionResult !== null) {
        // Если была конвертация, используем результат конвертации
        num = conversionResult;
    }
    else {
        // Стандартная логика для изменения баланса
        const expr = evaluateMathExpression(restOfText);
        num = expr !== null ? expr : (parseFlexibleNumber(restOfText) ?? null);
        if (num === null) {
            await bot.sendMessage(chatId, `⚠️ Формат: /${code} <±сумма|выражение> или /${code} eurusd 10000/1,015`);
            return;
        }
    }
    try {
        const { data: user } = await supabase
            .from("user")
            .select("id")
            .eq("telegram_id", msg.from.id)
            .single();
        if (!user) {
            await bot.sendMessage(chatId, "❌ Сначала зарегистрируйся через /start.");
            return;
        }
        // Получаем настройки счета (precision) из таблицы wallet
        let { data: acc } = await supabase
            .from("wallet")
            .select("id, precision")
            .eq("user_id", user.id)
            .eq("code", code)
            .single();
        if (!acc) {
            const defaultPrecision = 2;
            const { data: created, error: createErr } = await supabase
                .from("wallet")
                .insert({ user_id: user.id, code, precision: defaultPrecision, balance: 0 })
                .select("id, precision")
                .single();
            if (createErr) {
                console.error("wallet auto-create error:", createErr);
                await bot.sendMessage(chatId, `⚠️ Не удалось создать счёт ${code}.`);
                return;
            }
            acc = created;
        }
        const precision = acc.precision || 2;
        // Получаем текущий баланс из транзакций этого чата
        const { data: chatTransactions } = await supabase
            .from("wallet_tx")
            .select("amount")
            .eq("user_id", user.id)
            .eq("code", code)
            .eq("chat_id", chatId);
        const currentBalance = (chatTransactions || []).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
        const nextBalance = Number((currentBalance + num).toFixed(precision));
        // Добавляем транзакцию (не обновляем глобальный баланс в wallet)
        await supabase
            .from("wallet_tx")
            .insert({
            user_id: user.id,
            code,
            amount: Number(num.toFixed(precision)),
            balance_after: nextBalance,
            chat_id: msg.chat.id,
            chat_title: msg.chat.title || null,
            username: msg.from?.username || null,
        });
        const signed = num >= 0
            ? `+${formatWithApostrophe(num, precision)}`
            : `${formatWithApostrophe(num, precision)}`;
        const total = formatWithApostrophe(nextBalance, precision);
        let message = `Запомнил. <code>${signed}</code>\nБаланс: <code>${total}</code> ${code}`;
        if (conversionMessage) {
            message = `${conversionMessage}\n\n${message}`;
        }
        await bot.sendMessage(chatId, message, { parse_mode: "HTML" });
    }
    catch (e) {
        console.error("walletAdjust error:", e);
        await bot.sendMessage(chatId, "⚠️ Ошибка при изменении счёта.");
    }
};
