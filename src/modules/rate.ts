import { type Message } from "node-telegram-bot-api";
import { bot } from "../index.js";
import { launchPuppeteer } from "../utils/puppeteer.js";

function formatNumber(n: number, fractionDigits = 6): string {
  const d = Number(n.toFixed(fractionDigits));
  return d.toLocaleString("ru-RU", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  });
}

// Определяем, является ли валюта фиатной
function isFiatCurrency(code: string): boolean {
  const fiatCodes = [
    "USD",
    "EUR",
    "GBP",
    "JPY",
    "CAD",
    "AUD",
    "CHF",
    "CNY",
    "KZT",
    "RUB",
    "TRY",
    "UAH",
    "PLN",
    "KRW",
    "SGD",
    "HKD",
    "NZD",
    "MXN",
    "INR",
    "BRL",
    "ZAR",
    "SEK",
    "NOK",
    "DKK",
  ];
  return fiatCodes.includes(code.toUpperCase());
}

export function parsePairAndAmount(
  text: string
): { base: string; quote: string; amount: number; divisor?: number } | null {
  // Поддерживаем формат: /курс eurusd 10000/1,015 или /курс eurusd 10000/1.015
  const m = text.match(/^\/курс\s+([^\s]+)(?:\s+([\d.,]+))?(?:\/([\d.,]+))?$/i);
  if (!m) return null;
  let pair = m[1].replace(/\s+/g, "");
  pair = pair.replace("/", "").toUpperCase();
  const amount = m[2] ? parseFloat(m[2].replace(",", ".")) : 1;
  const divisor = m[3] ? parseFloat(m[3].replace(",", ".")) : undefined;

  if (!pair || pair.length < 6) return null;

  // Попытка сплит 3+3 (fiat-фиат)
  let base = pair.slice(0, 3);
  let quote = pair.slice(3);

  // Если quote не 3 символа, попробуем выделить по известным суффиксам (Binance)
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

export const rateModule = async (msg: Message): Promise<void> => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() || "";

  // Новый формат: несколько конвертаций внутри выражения:
  //   /курс eurusd (100000/0,991+100) - eurusd (100000/0,993+100)
  //   /курс usdkzt 3500-117000-150000-20000-100000
  //
  // Общая идея:
  //  - парсим все блоки "<пара> (выражение)" и/или "<пара> <сумма><операции...>"
  //  - считаем внутренние выражения как числа (amount)
  //  - для каждого делаем запрос к XE и получаем конвертированную сумму
  //  - собираем итоговое выражение и считаем его
  const calcPattern = /^\/курс\s+(.+)$/i;
  const calcMatch = text.match(calcPattern);
  if (calcMatch) {
    const exprPart = calcMatch[1].replace(/,/g, ".").replace(/[–—−]/g, "-");

    // 1) Блоки вида "<пара> (выражение)"
    const complexRegex = /([a-z]{3,10})\s*\(([^()]+)\)/gi;
    // 2) Блоки вида "<пара> <число><операции...>" (например: usdkzt 3500-117000-150000)
    const simpleRegex = /([a-z]{3,10})\s+(\d+(?:\.\d+)?(?:[+\-*/]\d+(?:\.\d+)?)+)/gi;

    const complexMatches = [...exprPart.matchAll(complexRegex)];
    const simpleMatches = [...exprPart.matchAll(simpleRegex)];

    type Segment = {
      full: string;
      placeholder: string;
      base: string;
      quote: string;
      amount: number;
      converted: number;
    };

    const segments: Segment[] = [];

    // Вспомогательная функция конвертации через XE
    const convertViaXE = async (
      base: string,
      quote: string,
      amount: number
    ): Promise<number | null> => {
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
        if (!element) return null;
        return element.textContent?.trim() || null;
      });

      await browser.close();

      if (!convertedText) return null;

      const cleaned = convertedText.replace(/\s+/g, "");
      const numberMatch = cleaned.match(/^([\d,]+\.?\d*)/);
      if (!numberMatch) return null;

      const convertedValueStr = numberMatch[1].replace(/,/g, "");
      const convertedValueNum = parseFloat(convertedValueStr);
      if (isNaN(convertedValueNum)) return null;
      return convertedValueNum;
    };

    try {
      let placeholderIndex = 0;

      // Обрабатываем сложные блоки "<пара> (выражение)"
      for (const m of complexMatches) {
        const full = m[0];
        const pairRaw = m[1];
        const innerExpr = m[2];

        const innerNorm = innerExpr.replace(/,/g, ".").replace(/[–—−]/g, "-");
        const innerSafe = innerNorm.replace(/[^0-9+\-*/().\s]/g, "");
        const amount = Function(`"use strict"; return (${innerSafe})`)();
        if (isNaN(amount)) {
          await bot.sendMessage(
            chatId,
            "❌ Не удалось вычислить выражение для суммы конвертации."
          );
          return;
        }

        // Берём только пару, amount уже посчитан выше (может быть и отрицательным)
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

      // Обрабатываем простые блоки "<пара> 3500-117000-150000"
      for (const m of simpleMatches) {
        const full = m[0];
        const pairRaw = m[1];
        const expr = m[2];

        // Пропускаем, если этот кусок уже попал в complexMatches (чтобы не дублировать)
        if (segments.some((s) => s.full === full)) continue;

        const exprNorm = expr.replace(/,/g, ".").replace(/[–—−]/g, "-");
        const exprSafe = exprNorm.replace(/[^0-9+\-*/().\s]/g, "");
        const amount = Function(`"use strict"; return (${exprSafe})`)();
        if (isNaN(amount)) {
          await bot.sendMessage(
            chatId,
            "❌ Не удалось вычислить выражение для суммы конвертации."
          );
          return;
        }

        // Берём только пару, amount уже посчитан выше (может быть и отрицательным)
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
        // Собираем итоговое выражение
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

        const displayExpr = exprForCalc.replace(/\s+/g, "");
        const formattedFinal = Number(finalResult.toFixed(6)).toLocaleString("ru-RU");

        await bot.sendMessage(
          chatId,
          `<code>${lines.join("\n")}</code>\n\n` +
            `<code>${displayExpr}</code> = <code>${formattedFinal}</code>`,
          { parse_mode: "HTML" }
        );
        return;
      }
    } catch (e) {
      console.error("/курс calc error:", e);
      await bot.sendMessage(
        chatId,
        "⚠️ Ошибка при вычислении выражения с конвертацией валют."
      );
      return;
    }
  }

  const parsed = parsePairAndAmount(text);
  if (!parsed) {
    await bot.sendMessage(
      chatId,
      "⚙️ Формат: /курс <пара> [сумма] [/делитель]\nПримеры: /курс eurusd 100, /курс eurusd 10000/1,015"
    );
    return;
  }

  const { base, quote, amount, divisor } = parsed;

  // Делаем скриншот страницы XE и парсим данные
  const url = `https://www.xe.com/currencyconverter/convert/?Amount=${encodeURIComponent(
    amount
  )}&From=${encodeURIComponent(base)}&To=${encodeURIComponent(quote)}`;

  try {
    const browser = await launchPuppeteer();
    const page = await browser.newPage();

    // Эмулируем iPhone для мобильной версии
    await page.setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    );
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    // Ждем появления блока конвертера
    await page.waitForSelector('div[data-testid="conversion"]', {
      timeout: 10000,
    });
    // Небольшая задержка, чтобы дорендерились виджеты
    await page.waitForTimeout(1500);

    // Парсим сумму конвертации (включая span с faded-digits)
    const convertedText = await page.evaluate(() => {
      const element = document.querySelector("p.sc-c5062ab2-1.jKDFIr");
      if (!element) return null;
      // textContent автоматически включает текст из всех дочерних элементов, включая span
      return element.textContent?.trim() || null;
    });

    // Парсим курсы
    const ratesData = await page.evaluate(() => {
      const element = document.querySelector("div.sc-98b4ec47-0.jnAVFH");
      if (!element) return null;
      const paragraphs = element.querySelectorAll("p");
      const rates: string[] = [];
      paragraphs.forEach((p) => {
        const text = p.textContent?.trim();
        if (text) rates.push(text);
      });
      return rates.length > 0 ? rates : null;
    });

    // Извлекаем числовые значения
    let convertedValueStr: string | null = null;
    let convertedValueNum: number | null = null;
    let rate1Text: string | null = null;
    let rate2Text: string | null = null;

    if (convertedText) {
      // Извлекаем число из текста типа "1,149.2238 US Dollar" или "52,975.918Kazakhstani Tenge"
      // Убираем все пробелы, затем правильно обрабатываем запятые (могут быть разделителями тысяч)
      const cleaned = convertedText.replace(/\s+/g, "");
      // Ищем число: может быть формат 1,149.2238 или 1149.2238
      const numberMatch = cleaned.match(/^([\d,]+\.?\d*)/);
      if (numberMatch) {
        // Убираем запятые (разделители тысяч) и оставляем точку как десятичный разделитель
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

    // Форматируем сумму конвертации
    const formattedAmount = amount.toLocaleString("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    // Форматируем конвертированную сумму
    const formattedConverted = convertedValueNum.toLocaleString("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    });

    // Формируем сообщение с данными из XE
    let message = `${formattedAmount} ${base} → ${quote}\n\n`;
    message += `XE Rate, ${dateStr}\n`;
    if (rate1Text) message += `${rate1Text}\n`;
    if (rate2Text) message += `${rate2Text}\n`;
    message += `\n<code>${formattedConverted}</code> ${quote}`;

    // Добавляем расчет только если указан делитель
    if (divisor && divisor > 0) {
      const finalAmount = convertedValueNum / divisor;
      const formattedFinal = finalAmount.toLocaleString("ru-RU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      const convertedForFormula = convertedValueNum.toFixed(2);
      const divisorForFormula = divisor.toString().replace(".", ",");
      message += `\n\n📊Расчет с делителем ${divisorForFormula}:\n`;
      message += `<code>${convertedForFormula} / ${divisorForFormula} = ${formattedFinal}</code>`;
    }

    // Делаем скриншот
    const converterBlock = await page.$(
      "div.relative.bg-gradient-to-l.from-blue-850.to-blue-700"
    );
    if (converterBlock) {
      const buf = await converterBlock.screenshot({ type: "png" });
      await browser.close();
      await bot.sendPhoto(chatId, buf as any, {
        caption: message,
        parse_mode: "HTML",
      });
    } else {
      await browser.close();
      await bot.sendMessage(chatId, message, { parse_mode: "HTML" });
      await bot.sendMessage(chatId, `Ссылка XE: ${url}`);
    }
  } catch (e) {
    console.error("/курс error:", e);
    await bot.sendMessage(chatId, "⚠️ Не удалось получить курс.");
    await bot.sendMessage(chatId, `Ссылка XE: ${url}`);
  }
};
