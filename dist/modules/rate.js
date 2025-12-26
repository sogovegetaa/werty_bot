import { bot } from "../index.js";
import { launchPuppeteer } from "../utils/puppeteer.js";
export function parsePairAndAmount(text) {
    const m = text.match(/^\/курс\s+([^\s]+)(?:\s+([\d.,]+))?(?:\/([\d.,]+))?$/i);
    if (!m)
        return null;
    let pair = m[1].replace(/\s+/g, "");
    pair = pair.replace("/", "").toUpperCase();
    const amount = m[2] ? parseFloat(m[2].replace(",", ".")) : 1;
    const divisor = m[3] ? parseFloat(m[3].replace(",", ".")) : undefined;
    if (!pair || pair.length < 6)
        return null;
    let base = pair.slice(0, 3);
    let quote = pair.slice(3);
    const knownSuffixes = [
        "USDT",
        "BUSD",
        "USDC",
        "TRY",
        "EUR",
        "RUB",
        "BTC",
        "ETH",
        "BNB",
        "TON",
        "TRX",
    ];
    if (quote.length !== 3) {
        const suffix = knownSuffixes.find((s) => pair.endsWith(s));
        if (suffix) {
            base = pair.slice(0, pair.length - suffix.length);
            quote = suffix;
        }
    }
    return {
        base,
        quote,
        amount: isNaN(amount) ? 1 : amount,
        divisor: divisor && !isNaN(divisor) ? divisor : undefined
    };
}
export const rateModule = async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim() || "";
    const percentMatch = text.match(/^\/курс\s+([^\s]+)\s+([\d.,]+)%([+\-]?[\d.,]+)$/i);
    if (percentMatch) {
        const pairRaw = percentMatch[1];
        const amountStr = percentMatch[2];
        const percentRaw = percentMatch[3];
        const percentVal = parseFloat(percentRaw.replace(",", "."));
        const percentAbs = Math.abs(percentVal);
        if (isNaN(percentVal) || percentAbs <= 0) {
            await bot.sendMessage(chatId, "❌ Неверный процент. Используй формат: /курс eurusd 10000%1.5");
            return;
        }
        const parsedBase = parsePairAndAmount(`/курс ${pairRaw} ${amountStr}`);
        if (!parsedBase) {
            await bot.sendMessage(chatId, "⚙️ Формат: /курс <пара> <сумма>%<процент>\nНапример: /курс eurusd 10000%1.5");
            return;
        }
        const { base, quote, amount } = parsedBase;
        const url = `https://www.xe.com/currencyconverter/convert/?Amount=${encodeURIComponent(amount)}&From=${encodeURIComponent(base)}&To=${encodeURIComponent(quote)}`;
        try {
            const browser = await launchPuppeteer();
            const page = await browser.newPage();
            await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
            await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
            await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
            await page.waitForSelector('form[data-hs-cf-bound]', {
                timeout: 10000,
            });
            await page.waitForTimeout(1500);
            const convertedText = await page.evaluate(() => {
                const input = document.querySelector('fieldset:last-of-type input[aria-label="Receiving amount"]');
                if (!input)
                    return null;
                return input.value?.trim() || null;
            });
            const ratesData = await page.evaluate(() => {
                const rateElement = document.querySelector('p.text-lg.font-semibold.text-xe-neutral-900');
                const timeElement = rateElement?.nextElementSibling;
                const rates = [];
                if (rateElement) {
                    const rateText = rateElement.textContent?.trim();
                    if (rateText)
                        rates.push(rateText);
                }
                if (timeElement) {
                    const timeText = timeElement.textContent?.trim();
                    if (timeText)
                        rates.push(timeText);
                }
                return rates.length > 0 ? rates : null;
            });
            let convertedValueNum = null;
            if (convertedText) {
                const cleaned = convertedText.replace(/\s+/g, "");
                const numberMatch = cleaned.match(/^([\d,]+\.?\d*)/);
                if (numberMatch) {
                    const convertedValueStr = numberMatch[1].replace(/,/g, "");
                    convertedValueNum = parseFloat(convertedValueStr);
                }
            }
            if (!convertedValueNum) {
                await browser.close();
                await bot.sendMessage(chatId, "❌ Не удалось получить данные с XE.com.");
                return;
            }
            let rate1Text = null;
            let rate2Text = null;
            if (ratesData && ratesData.length > 0) {
                rate1Text = ratesData[0];
                if (ratesData.length > 1)
                    rate2Text = ratesData[1];
            }
            const now = new Date();
            const day = String(now.getUTCDate()).padStart(2, "0");
            const month = String(now.getUTCMonth() + 1).padStart(2, "0");
            const year = now.getUTCFullYear();
            const dateStr = `${day}-${month}-${year}`;
            const formattedAmount = amount.toLocaleString("ru-RU", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            });
            const formattedConverted = convertedValueNum.toLocaleString("ru-RU", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 8,
            });
            const signChar = percentRaw.trim().startsWith("+") ? "+" : "-";
            const discount = (convertedValueNum * percentAbs) / 100;
            const finalAmount = signChar === "+"
                ? convertedValueNum + discount
                : convertedValueNum - discount;
            const formattedFinal = finalAmount.toLocaleString("ru-RU", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            });
            const convertedForFormula = convertedValueNum.toFixed(2).replace(".", ",");
            const percentForFormula = percentAbs.toString().replace(".", ",");
            let message = `${formattedAmount} ${base} → ${quote}\n\n`;
            message += `XE Rate, ${dateStr}\n`;
            if (rate1Text)
                message += `${rate1Text}\n`;
            if (rate2Text)
                message += `${rate2Text}\n`;
            message += `\n<code>${formattedConverted}</code> ${quote}`;
            message += `\n\n📊Rate adjustment (${signChar}${percentForFormula}%):\n`;
            if (signChar === "+") {
                message += `<code>${convertedForFormula} + (${convertedForFormula} * ${percentForFormula}/100) = ${formattedFinal}</code>`;
            }
            else {
                message += `<code>${convertedForFormula} - (${convertedForFormula} * ${percentForFormula}/100) = ${formattedFinal}</code>`;
            }
            await page.evaluate(() => {
                const section = document.querySelector('section.relative.w-full.bg-gradient-to-l.from-blue-850.to-blue-700');
                if (section) {
                    const lastP = section.querySelector('p:last-of-type');
                    if (lastP && lastP.textContent?.includes('We use the mid-market rate')) {
                        lastP.style.display = 'none';
                    }
                    const buttons = section.querySelectorAll('button, a');
                    buttons.forEach((btn) => {
                        const text = btn.textContent?.trim() || '';
                        if (text.includes('Track exchange rates') || text.includes('Send money')) {
                            btn.style.display = 'none';
                        }
                    });
                }
            });
            const converterBlock = await page.$("section.relative.w-full.bg-gradient-to-l.from-blue-850.to-blue-700");
            if (converterBlock) {
                const buf = await converterBlock.screenshot({ type: "png" });
                await browser.close();
                await bot.sendPhoto(chatId, buf, {
                    caption: message,
                    parse_mode: "HTML",
                });
            }
            else {
                await browser.close();
                await bot.sendMessage(chatId, message, { parse_mode: "HTML" });
                await bot.sendMessage(chatId, `Ссылка XE: ${url}`);
            }
            return;
        }
        catch (e) {
            console.error("/курс percent error:", e);
            await bot.sendMessage(chatId, "⚠️ Не удалось получить курс.");
            await bot.sendMessage(chatId, `Ссылка XE: ${url}`);
            return;
        }
    }
    const calcPattern = /^\/курс\s+(.+)$/i;
    const calcMatch = text.match(calcPattern);
    if (calcMatch && !parsePairAndAmount(text)) {
        const exprPart = calcMatch[1].replace(/,/g, ".").replace(/[–—−]/g, "-");
        const complexRegex = /([a-z]{3,10})\s*\(([^()]+)\)/gi;
        const simpleRegex = /([a-z]{3,10})\s+(\d+(?:\.\d+)?(?:[+\-*/]\d+(?:\.\d+)?)+)/gi;
        const complexMatches = [...exprPart.matchAll(complexRegex)];
        const simpleMatches = [...exprPart.matchAll(simpleRegex)];
        const segments = [];
        const convertViaXE = async (base, quote, amount) => {
            const url = `https://www.xe.com/currencyconverter/convert/?Amount=${encodeURIComponent(amount)}&From=${encodeURIComponent(base)}&To=${encodeURIComponent(quote)}`;
            const browser = await launchPuppeteer();
            const page = await browser.newPage();
            await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
            await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
            await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
            await page.waitForSelector('form[data-hs-cf-bound]', { timeout: 10000 });
            await page.waitForTimeout(1500);
            const convertedText = await page.evaluate(() => {
                const input = document.querySelector('fieldset:last-of-type input[aria-label="Receiving amount"]');
                if (!input)
                    return null;
                return input.value?.trim() || null;
            });
            await browser.close();
            if (!convertedText)
                return null;
            const cleaned = convertedText.replace(/\s+/g, "");
            const numberMatch = cleaned.match(/^([\d,]+\.?\d*)/);
            if (!numberMatch)
                return null;
            const convertedValueStr = numberMatch[1].replace(/,/g, "");
            const convertedValueNum = parseFloat(convertedValueStr);
            if (isNaN(convertedValueNum))
                return null;
            return convertedValueNum;
        };
        try {
            let placeholderIndex = 0;
            for (const m of complexMatches) {
                const full = m[0];
                const pairRaw = m[1];
                const innerExpr = m[2];
                const innerNorm = innerExpr.replace(/,/g, ".").replace(/[–—−]/g, "-");
                const innerSafe = innerNorm.replace(/[^0-9+\-*/().\s]/g, "");
                const amount = Function(`"use strict"; return (${innerSafe})`)();
                if (isNaN(amount)) {
                    await bot.sendMessage(chatId, "❌ Не удалось вычислить выражение для суммы конвертации.");
                    return;
                }
                const parsedPair = parsePairAndAmount(`/курс ${pairRaw}`);
                if (!parsedPair) {
                    await bot.sendMessage(chatId, `❌ Неверная валютная пара: ${pairRaw}.`);
                    return;
                }
                const { base, quote } = parsedPair;
                const converted = await convertViaXE(base, quote, amount);
                if (converted === null) {
                    await bot.sendMessage(chatId, "❌ Не удалось получить данные с XE.com.");
                    return;
                }
                segments.push({
                    full,
                    placeholder: `__R${placeholderIndex++}__`,
                    base,
                    quote,
                    amount,
                    converted,
                });
            }
            for (const m of simpleMatches) {
                const full = m[0];
                const pairRaw = m[1];
                const expr = m[2];
                if (segments.some((s) => s.full === full))
                    continue;
                const exprNorm = expr.replace(/,/g, ".").replace(/[–—−]/g, "-");
                const exprSafe = exprNorm.replace(/[^0-9+\-*/().\s]/g, "");
                const amount = Function(`"use strict"; return (${exprSafe})`)();
                if (isNaN(amount)) {
                    await bot.sendMessage(chatId, "❌ Не удалось вычислить выражение для суммы конвертации.");
                    return;
                }
                const parsedPair = parsePairAndAmount(`/курс ${pairRaw}`);
                if (!parsedPair) {
                    await bot.sendMessage(chatId, `❌ Неверная валютная пара: ${pairRaw}.`);
                    return;
                }
                const { base, quote } = parsedPair;
                const converted = await convertViaXE(base, quote, amount);
                if (converted === null) {
                    await bot.sendMessage(chatId, "❌ Не удалось получить данные с XE.com.");
                    return;
                }
                segments.push({
                    full,
                    placeholder: `__R${placeholderIndex++}__`,
                    base,
                    quote,
                    amount,
                    converted,
                });
            }
            if (segments.length > 0) {
                let exprForCalc = exprPart;
                for (const seg of segments) {
                    exprForCalc = exprForCalc.replace(seg.full, seg.placeholder);
                }
                for (const seg of segments) {
                    exprForCalc = exprForCalc.replace(seg.placeholder, seg.converted.toString());
                }
                const safeFinal = exprForCalc.replace(/[^0-9+\-*/().\s]/g, "");
                const finalResult = Function(`"use strict"; return (${safeFinal})`)();
                if (isNaN(finalResult)) {
                    await bot.sendMessage(chatId, "❌ Не удалось вычислить итоговое выражение.");
                    return;
                }
                const lines = [];
                for (const seg of segments) {
                    const formattedAmount = Number(seg.amount.toFixed(6)).toLocaleString("ru-RU");
                    const formattedConverted = seg.converted.toLocaleString("ru-RU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                    });
                    lines.push(`${formattedAmount} ${seg.base} → ${seg.quote} = ${formattedConverted}`);
                }
                const displayExpr = exprForCalc.replace(/\s+/g, "");
                const formattedFinal = Number(finalResult.toFixed(6)).toLocaleString("ru-RU");
                const mainSeg = segments[0];
                const url = `https://www.xe.com/currencyconverter/convert/?Amount=${encodeURIComponent(mainSeg.amount)}&From=${encodeURIComponent(mainSeg.base)}&To=${encodeURIComponent(mainSeg.quote)}`;
                try {
                    const browser = await launchPuppeteer();
                    const page = await browser.newPage();
                    await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
                    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
                    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
                    await page.waitForSelector('form[data-hs-cf-bound]', {
                        timeout: 10000,
                    });
                    await page.waitForTimeout(1500);
                    const convertedText = await page.evaluate(() => {
                        const input = document.querySelector('fieldset:last-of-type input[aria-label="Receiving amount"]');
                        if (!input)
                            return null;
                        return input.value?.trim() || null;
                    });
                    const ratesData = await page.evaluate(() => {
                        const rateElement = document.querySelector('p.text-lg.font-semibold.text-xe-neutral-900');
                        const timeElement = rateElement?.nextElementSibling;
                        const rates = [];
                        if (rateElement) {
                            const rateText = rateElement.textContent?.trim();
                            if (rateText)
                                rates.push(rateText);
                        }
                        if (timeElement) {
                            const timeText = timeElement.textContent?.trim();
                            if (timeText)
                                rates.push(timeText);
                        }
                        return rates.length > 0 ? rates : null;
                    });
                    let convertedValueNum = null;
                    if (convertedText) {
                        const cleaned = convertedText.replace(/\s+/g, "");
                        const numberMatch = cleaned.match(/^([\d,]+\.?\d*)/);
                        if (numberMatch) {
                            const convertedValueStr = numberMatch[1].replace(/,/g, "");
                            convertedValueNum = parseFloat(convertedValueStr);
                        }
                    }
                    if (!convertedValueNum) {
                        await browser.close();
                        await bot.sendMessage(chatId, "❌ Не удалось получить данные с XE.com.");
                        return;
                    }
                    let rate1Text = null;
                    let rate2Text = null;
                    if (ratesData && ratesData.length > 0) {
                        rate1Text = ratesData[0];
                        if (ratesData.length > 1)
                            rate2Text = ratesData[1];
                    }
                    const now = new Date();
                    const day = String(now.getUTCDate()).padStart(2, "0");
                    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
                    const year = now.getUTCFullYear();
                    const dateStr = `${day}-${month}-${year}`;
                    const formattedAmountMain = mainSeg.amount.toLocaleString("ru-RU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                    });
                    const formattedConvertedMain = convertedValueNum.toLocaleString("ru-RU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 8,
                    });
                    let caption = `${formattedAmountMain} ${mainSeg.base} → ${mainSeg.quote}\n\n` +
                        `XE Rate, ${dateStr}\n`;
                    if (rate1Text)
                        caption += `${rate1Text}\n`;
                    if (rate2Text)
                        caption += `${rate2Text}\n`;
                    caption += `\n<code>${formattedConvertedMain}</code> ${mainSeg.quote}`;
                    caption += `\n\n<code>${lines.join("\n")}</code>\n\n` +
                        `<code>${displayExpr}</code> = <code>${formattedFinal}</code>`;
                    await page.evaluate(() => {
                        const section = document.querySelector('section.relative.w-full.bg-gradient-to-l.from-blue-850.to-blue-700');
                        if (section) {
                            const lastP = section.querySelector('p:last-of-type');
                            if (lastP && lastP.textContent?.includes('We use the mid-market rate')) {
                                lastP.style.display = 'none';
                            }
                            const buttons = section.querySelectorAll('button, a');
                            buttons.forEach((btn) => {
                                const text = btn.textContent?.trim() || '';
                                if (text.includes('Track exchange rates') || text.includes('Send money')) {
                                    btn.style.display = 'none';
                                }
                            });
                        }
                    });
                    const converterBlock = await page.$("section.relative.w-full.bg-gradient-to-l.from-blue-850.to-blue-700");
                    if (converterBlock) {
                        const buf = await converterBlock.screenshot({ type: "png" });
                        await browser.close();
                        await bot.sendPhoto(chatId, buf, {
                            caption,
                            parse_mode: "HTML",
                        });
                    }
                    else {
                        await browser.close();
                        await bot.sendMessage(chatId, caption, { parse_mode: "HTML" });
                        await bot.sendMessage(chatId, `Ссылка XE: ${url}`);
                    }
                }
                catch (e) {
                    console.error("/курс calc screenshot error:", e);
                    await bot.sendMessage(chatId, `<code>${lines.join("\n")}</code>\n\n` +
                        `<code>${displayExpr}</code> = <code>${formattedFinal}</code>`, { parse_mode: "HTML" });
                }
                return;
            }
        }
        catch (e) {
            console.error("/курс calc error:", e);
            await bot.sendMessage(chatId, "⚠️ Ошибка при вычислении выражения с конвертацией валют.");
            return;
        }
    }
    const parsed = parsePairAndAmount(text);
    if (!parsed) {
        await bot.sendMessage(chatId, "⚙️ Формат: /курс <пара> [сумма] [/делитель]\nПримеры: /курс eurusd 100, /курс eurusd 10000/1,015");
        return;
    }
    const { base, quote, amount, divisor } = parsed;
    const url = `https://www.xe.com/currencyconverter/convert/?Amount=${encodeURIComponent(amount)}&From=${encodeURIComponent(base)}&To=${encodeURIComponent(quote)}`;
    try {
        const browser = await launchPuppeteer();
        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
        await page.waitForSelector('form[data-hs-cf-bound]', {
            timeout: 10000,
        });
        await page.waitForTimeout(1500);
        const convertedText = await page.evaluate(() => {
            const input = document.querySelector('fieldset:last-of-type input[aria-label="Receiving amount"]');
            if (!input)
                return null;
            return input.value?.trim() || null;
        });
        const ratesData = await page.evaluate(() => {
            const rateElement = document.querySelector('p.text-lg.font-semibold.text-xe-neutral-900');
            const timeElement = rateElement?.nextElementSibling;
            const rates = [];
            if (rateElement) {
                const rateText = rateElement.textContent?.trim();
                if (rateText)
                    rates.push(rateText);
            }
            if (timeElement) {
                const timeText = timeElement.textContent?.trim();
                if (timeText)
                    rates.push(timeText);
            }
            return rates.length > 0 ? rates : null;
        });
        let convertedValueStr = null;
        let convertedValueNum = null;
        let rate1Text = null;
        let rate2Text = null;
        if (convertedText) {
            const cleaned = convertedText.replace(/\s+/g, "");
            const numberMatch = cleaned.match(/^([\d,]+\.?\d*)/);
            if (numberMatch) {
                convertedValueStr = numberMatch[1].replace(/,/g, "");
                convertedValueNum = parseFloat(convertedValueStr);
            }
        }
        if (ratesData && ratesData.length > 0) {
            rate1Text = ratesData[0];
            if (ratesData.length > 1) {
                rate2Text = ratesData[1];
            }
        }
        if (!convertedValueNum || !rate1Text) {
            await browser.close();
            await bot.sendMessage(chatId, `❌ Не удалось получить данные с XE.com.`);
            return;
        }
        const now = new Date();
        const day = String(now.getUTCDate()).padStart(2, "0");
        const month = String(now.getUTCMonth() + 1).padStart(2, "0");
        const year = now.getUTCFullYear();
        const dateStr = `${day}-${month}-${year}`;
        const formattedAmount = amount.toLocaleString("ru-RU", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
        const formattedConverted = convertedValueNum.toLocaleString("ru-RU", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 8,
        });
        let message = `${formattedAmount} ${base} → ${quote}\n\n`;
        message += `XE Rate, ${dateStr}\n`;
        if (rate1Text)
            message += `${rate1Text}\n`;
        if (rate2Text)
            message += `${rate2Text}\n`;
        message += `\n<code>${formattedConverted}</code> ${quote}`;
        if (divisor && divisor > 0) {
            const finalAmount = convertedValueNum / divisor;
            const formattedFinal = finalAmount.toLocaleString("ru-RU", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            });
            const convertedForFormula = convertedValueNum.toFixed(2);
            const divisorForFormula = divisor.toString().replace(".", ",");
            message += `\n\n📊Rate adjustment:\n`;
            message += `<code>${convertedForFormula} / ${divisorForFormula} = ${formattedFinal}</code>`;
        }
        await page.evaluate(() => {
            const section = document.querySelector('section.relative.w-full.bg-gradient-to-l.from-blue-850.to-blue-700');
            if (section) {
                const lastP = section.querySelector('p:last-of-type');
                if (lastP && lastP.textContent?.includes('We use the mid-market rate')) {
                    lastP.style.display = 'none';
                }
                const buttons = section.querySelectorAll('button, a');
                buttons.forEach((btn) => {
                    const text = btn.textContent?.trim() || '';
                    if (text.includes('Track exchange rates') || text.includes('Send money')) {
                        btn.style.display = 'none';
                    }
                });
            }
        });
        const converterBlock = await page.$("section.relative.w-full.bg-gradient-to-l.from-blue-850.to-blue-700");
        if (converterBlock) {
            const buf = await converterBlock.screenshot({ type: "png" });
            await browser.close();
            await bot.sendPhoto(chatId, buf, {
                caption: message,
                parse_mode: "HTML",
            });
        }
        else {
            await browser.close();
            await bot.sendMessage(chatId, message, { parse_mode: "HTML" });
            await bot.sendMessage(chatId, `Ссылка XE: ${url}`);
        }
    }
    catch (e) {
        console.error("/курс error:", e);
        await bot.sendMessage(chatId, "⚠️ Не удалось получить курс.");
        await bot.sendMessage(chatId, `Ссылка XE: ${url}`);
    }
};
