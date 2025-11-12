import { bot } from "../index.js";
import { type Message } from "node-telegram-bot-api";
import { parsePairAndAmount } from "./rate.js";
import { launchPuppeteer } from "../utils/puppeteer.js";

export const calcModule = async (msg: Message): Promise<void> => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() || "";

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
      "⚙️ Форматы: /калк <выражение> или /<выражение>\nНапример: /калк 500000/0.994-300*924 или /123+123*2"
    );
    return;
  }

  const rawExpr = (mNamed ? mNamed[1] : (mDirect as RegExpMatchArray)[1]) || "";
  const normalized = rawExpr
    .replace(/,/g, ".")
    .replace(/[–—−]/g, "-");

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
