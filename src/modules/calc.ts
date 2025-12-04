import { bot } from "../index.js";
import { type Message } from "node-telegram-bot-api";
import { parsePairAndAmount } from "./rate.js";
import { launchPuppeteer } from "../utils/puppeteer.js";

export const calcModule = async (msg: Message): Promise<void> => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() || "";

  // Проверяем формат: /калк <пара> <сумма><операция><число> (например: /калк usdkzt 1000-117000)
  // Поддерживает: /калк usdkzt 1000-117000, /калк eurusd 1000+500, /калк usdkzt 1000-117000+500 и т.д.
  const currencyWithCalcMatch = text.match(/^\/калк\s+([a-z]{3,6})\s+(\d+(?:[.,]\d+)?)\s*([+\-*/][\d.,+\-*/()\s]+)$/i);
  if (currencyWithCalcMatch) {
    const pair = currencyWithCalcMatch[1].toUpperCase();
    const amountStr = currencyWithCalcMatch[2].replace(",", ".");
    const amount = parseFloat(amountStr);
    const mathExpr = currencyWithCalcMatch[3].trim();
    
    // Определяем base и quote из пары
    let base = pair.slice(0, 3);
    let quote = pair.slice(3);
    
    // Если quote не 3 символа, пробуем найти известные суффиксы
    if (quote.length !== 3) {
      const knownSuffixes = ["USDT", "BUSD", "USDC", "TRY", "EUR", "RUB", "BTC", "ETH", "BNB", "TON", "TRX"];
      const suffix = knownSuffixes.find((s) => pair.endsWith(s));
      if (suffix) {
        base = pair.slice(0, pair.length - suffix.length);
        quote = suffix;
      }
    }
    
    if (base && quote && base.length >= 3 && quote.length >= 3) {
      const url = `https://www.xe.com/currencyconverter/convert/?Amount=${encodeURIComponent(
        amount
      )}&From=${encodeURIComponent(base)}&To=${encodeURIComponent(quote)}`;
      
      try {
        const browser = await launchPuppeteer();
        const page = await browser.newPage();
        await page.setUserAgent(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        );
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
        await page.waitForSelector('form[data-hs-cf-bound]', { timeout: 10000 });
        await page.waitForTimeout(1500);
        
        const convertedText = await page.evaluate(() => {
          const input = document.querySelector('fieldset:last-of-type input[aria-label="Receiving amount"]') as HTMLInputElement | null;
          return input?.value?.trim() || null;
        });
        
        await browser.close();
        
        if (convertedText) {
          const cleaned = convertedText.replace(/\s+/g, "");
          const numberMatch = cleaned.match(/^([\d,]+\.?\d*)/);
          if (numberMatch) {
            const convertedValueStr = numberMatch[1].replace(/,/g, "");
            const convertedValueNum = parseFloat(convertedValueStr);
            
            // Выполняем математическое выражение с результатом конвертации
            const normalizedMathExpr = mathExpr.replace(/,/g, ".").replace(/[–—−]/g, "-");
            const expression = normalizedMathExpr.replace(/[^-+*/().0-9\s]/g, "");
            
            try {
              const finalResult = Function(`"use strict"; return (${convertedValueNum}${expression})`)();
              
              if (isNaN(finalResult)) {
                await bot.sendMessage(chatId, "❌ Не удалось вычислить выражение.");
                return;
              }
              
              const formattedConverted = convertedValueNum.toLocaleString("ru-RU", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              });
              const formattedResult = Number(finalResult.toFixed(6)).toLocaleString("ru-RU");
              
              await bot.sendMessage(
                chatId,
                `<code>${amount} ${base} → ${quote} = ${formattedConverted}</code>\n` +
                `<code>${formattedConverted} ${normalizedMathExpr.replace(/\s+/g, "")} = ${formattedResult}</code>`,
                { parse_mode: "HTML" }
              );
              return;
            } catch (err) {
              console.error("/калк math error:", err);
              await bot.sendMessage(chatId, "⚠️ Ошибка при вычислении выражения.");
              return;
            }
          }
        }
        
        await bot.sendMessage(chatId, `❌ Не удалось получить данные с XE.com.`);
        return;
      } catch (e) {
        console.error("/калк currency error:", e);
        await bot.sendMessage(chatId, "⚠️ Ошибка при конвертации валюты.");
        return;
      }
    }
  }

  // Проверяем, не является ли это запросом на конвертацию валюты с делителем
  // Формат: /калк eurusd 10000/1,015
  const restMatch = text.match(/^\/калк\s+(.+)$/i);
  if (restMatch) {
    const rest = restMatch[1];
    // Проверяем, не начинается ли с числа (тогда это обычное выражение)
    if (!rest.match(/^\d/)) {
      const parsed = parsePairAndAmount(text);
      if (parsed && parsed.base && parsed.quote) {
      // Это запрос на конвертацию валюты
      const { base, quote, amount, divisor } = parsed;
      
      const url = `https://www.xe.com/currencyconverter/convert/?Amount=${encodeURIComponent(
        amount
      )}&From=${encodeURIComponent(base)}&To=${encodeURIComponent(quote)}`;
      
      try {
        const browser = await launchPuppeteer();
        const page = await browser.newPage();
        await page.setUserAgent(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        );
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
        await page.waitForSelector('form[data-hs-cf-bound]', { timeout: 10000 });
        await page.waitForTimeout(1500);
        
        const convertedText = await page.evaluate(() => {
          const input = document.querySelector('fieldset:last-of-type input[aria-label="Receiving amount"]') as HTMLInputElement | null;
          return input?.value?.trim() || null;
        });
        
        await browser.close();
        
        if (convertedText) {
          const cleaned = convertedText.replace(/\s+/g, "");
          const numberMatch = cleaned.match(/^([\d,]+\.?\d*)/);
          if (numberMatch) {
            const convertedValueStr = numberMatch[1].replace(/,/g, "");
            const convertedValueNum = parseFloat(convertedValueStr);
            
            let result = convertedValueNum;
            let resultMessage = `${amount} ${base} → ${quote} = ${convertedValueNum.toFixed(2)}`;
            
            if (divisor && divisor > 0) {
              result = convertedValueNum / divisor;
              resultMessage += `\n${convertedValueNum.toFixed(2)} / ${divisor} = ${result.toFixed(2)}`;
            }
            
            await bot.sendMessage(
              chatId,
              `<code>${resultMessage}</code>`,
              { parse_mode: "HTML" }
            );
            return;
          }
        }
        
        await bot.sendMessage(chatId, `❌ Не удалось получить данные с XE.com.`);
        return;
      } catch (e) {
        console.error("/калк currency error:", e);
        await bot.sendMessage(chatId, "⚠️ Ошибка при конвертации валюты.");
        return;
      }
      }
    }
  }

  // Поддерживаем два формата:
  // 1) /калк <expr>
  // 2) /<expr>  (где expr состоит из цифр, пробелов и +-*/().,% и может содержать юникодные дефисы)
  const mNamed = text.match(/^\/калк\s+(.+)/i);
  const mDirect = !mNamed && text.match(/^\/([0-9(][0-9.,+\-*/()%\s–—−]*)$/);
  if (!mNamed && !mDirect) {
    await bot.sendMessage(
      chatId,
      "⚙️ Форматы:\n" +
      "• /калк <выражение> или /<выражение>\n" +
      "• /калк <пара> <сумма><операция><число> (например: /калк usdkzt 1000-117000)\n" +
      "• /калк <пара> <сумма>/<делитель> (например: /калк eurusd 10000/1,015)\n" +
      "Примеры: /калк 500000/0.994-300*924, /123+123*2, /калк usdkzt 1000-117000"
    );
    return;
  }

  const rawExpr = (mNamed ? mNamed[1] : (mDirect as RegExpMatchArray)[1]) || "";
  const normalized = rawExpr
    .replace(/,/g, ".")
    .replace(/[–—−]/g, "-");

  // Новый формат: несколько конвертаций вида "eurusd (100000/0.991+100)" в одном выражении:
  // /калк eurusd (100000/0.991+100) - eurusd (100000/0.993+100)
  const multiCurrencyRegex = /([a-z]{3,10})\s*\(([^()]+)\)/gi;
  const multiMatches = [...normalized.matchAll(multiCurrencyRegex)];

  if (multiMatches.length > 0) {
    type Segment = {
      full: string;
      placeholder: string;
      base: string;
      quote: string;
      amount: number;
      converted: number;
    };

    const segments: Segment[] = [];

    try {
      for (let i = 0; i < multiMatches.length; i++) {
        const m = multiMatches[i];
        const full = m[0];
        const pairRaw = m[1];
        const innerExpr = m[2];

        // Считаем внутреннее выражение (например: 100000/0.991+100)
        const innerNormalized = innerExpr
          .replace(/,/g, ".")
          .replace(/[–—−]/g, "-");

        let innerWithPercent = innerNormalized.replace(
          /(\d+(?:\.\d+)?)\s*([+\-])\s*(\d+(?:\.\d+)?)%/g,
          (_mm, a: string, op: string, b: string) => `(${a}${op}(${a}*(${b}/100)))`
        );
        innerWithPercent = innerWithPercent.replace(
          /(\d+(?:\.\d+)?)%/g,
          (_mm, x: string) => `((${x})/100)`
        );

        const innerSafe = innerWithPercent.replace(/[^-+*/().0-9\s]/g, "");
        const amount = Function(`"use strict"; return (${innerSafe})`)();

        if (isNaN(amount)) {
          await bot.sendMessage(chatId, "❌ Не удалось вычислить выражение для суммы конвертации.");
          return;
        }

        const parsedPair = parsePairAndAmount(`/курс ${pairRaw} ${amount}`);
        if (!parsedPair) {
          await bot.sendMessage(chatId, `❌ Неверная валютная пара: ${pairRaw}.`);
          return;
        }

        const { base, quote } = parsedPair;

        const url = `https://www.xe.com/currencyconverter/convert/?Amount=${encodeURIComponent(
          amount
        )}&From=${encodeURIComponent(base)}&To=${encodeURIComponent(quote)}`;

        const browser = await launchPuppeteer();
        const page = await browser.newPage();
        await page.setUserAgent(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        );
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
        await page.waitForSelector('div[data-testid="conversion"]', { timeout: 10000 });
        await page.waitForTimeout(1500);

        const convertedText = await page.evaluate(() => {
          const element = document.querySelector("p.sc-c5062ab2-1.jKDFIr");
          return element?.textContent?.trim() || null;
        });

        await browser.close();

        if (!convertedText) {
          await bot.sendMessage(chatId, "❌ Не удалось получить данные с XE.com.");
          return;
        }

        const cleaned = convertedText.replace(/\s+/g, "");
        const numberMatch = cleaned.match(/^([\d,]+\.?\d*)/);
        if (!numberMatch) {
          await bot.sendMessage(chatId, "❌ Не удалось разобрать ответ XE.com.");
          return;
        }

        const convertedValueStr = numberMatch[1].replace(/,/g, "");
        const convertedValueNum = parseFloat(convertedValueStr);

        if (isNaN(convertedValueNum)) {
          await bot.sendMessage(chatId, "❌ Не удалось преобразовать сумму из XE.com.");
          return;
        }

        segments.push({
          full,
          placeholder: `__C${i}__`,
          base,
          quote,
          amount,
          converted: convertedValueNum,
        });
      }

      // Собираем итоговое выражение: подставляем вместо eurusd(...) полученные числа
      let exprForCalc = normalized;
      for (const seg of segments) {
        exprForCalc = exprForCalc.replace(seg.full, seg.placeholder);
      }
      for (const seg of segments) {
        exprForCalc = exprForCalc.replace(seg.placeholder, seg.converted.toString());
      }

      // Поддержка процентов в итоговом выражении
      let withPercentFinal = exprForCalc.replace(
        /(\d+(?:\.\d+)?)\s*([+\-])\s*(\d+(?:\.\d+)?)%/g,
        (_m, a: string, op: string, b: string) => `(${a}${op}(${a}*(${b}/100)))`
      );
      withPercentFinal = withPercentFinal.replace(
        /(\d+(?:\.\d+)?)%/g,
        (_m, x: string) => `((${x})/100)`
      );

      const expressionFinal = withPercentFinal.replace(/[^-+*/().0-9\s]/g, "");
      const finalResult = Function(`"use strict"; return (${expressionFinal})`)();

      if (isNaN(finalResult)) {
        await bot.sendMessage(chatId, "❌ Не удалось вычислить итоговое выражение.");
        return;
      }

      const lines: string[] = [];
      for (const seg of segments) {
        const formattedAmount = Number(seg.amount.toFixed(6)).toLocaleString("ru-RU");
        const formattedConverted = seg.converted.toLocaleString("ru-RU", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 6,
        });
        lines.push(
          `${formattedAmount} ${seg.base} → ${seg.quote} = ${formattedConverted}`
        );
      }

      const displayExprFinal = exprForCalc.replace(/\s+/g, "");
      const formattedFinal = Number(finalResult.toFixed(6)).toLocaleString("ru-RU");

      await bot.sendMessage(
        chatId,
        `<code>${lines.join("\n")}</code>\n\n` +
          `<code>${displayExprFinal}</code> = <code>${formattedFinal}</code>`,
        { parse_mode: "HTML" }
      );
      return;
    } catch (err) {
      console.error("/калк multi-currency error:", err);
      await bot.sendMessage(chatId, "⚠️ Ошибка при вычислении выражения с конвертацией валют.");
      return;
    }
  }

  // Что показываем пользователю (без лишних пробелов, сохраняем %)
  const displayExpr = normalized.replace(/\s+/g, "");

  // Поддержка процентов:
  // 1) "A + B%" или "A - B%" => "A + (A*(B/100))" или "A - (A*(B/100))"
  // 2) оставшиеся "X%" => "(X/100)"
  let withPercent = normalized.replace(
    /(\d+(?:\.\d+)?)\s*([+\-])\s*(\d+(?:\.\d+)?)%/g,
    (_m, a: string, op: string, b: string) => `(${a}${op}(${a}*(${b}/100)))`
  );
  withPercent = withPercent.replace(/(\d+(?:\.\d+)?)%/g, (_m, x: string) => `((${x})/100)`);

  const expression = withPercent.replace(/[^-+*/().0-9\s]/g, "");

  try {
    const result = Function(`"use strict"; return (${expression})`)();

    if (isNaN(result)) {
      await bot.sendMessage(chatId, "❌ Не удалось вычислить выражение.");
      return;
    }

    const formatted = Number(result.toFixed(6)).toLocaleString("ru-RU");

    await bot.sendMessage(
      chatId,
      `<code>${displayExpr}</code> = <code>${formatted}</code>`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    console.error("Ошибка /калк:", err);
    await bot.sendMessage(chatId, "⚠️ Ошибка при вычислении выражения.");
  }
};
