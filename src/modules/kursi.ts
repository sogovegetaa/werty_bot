import { type Message } from "node-telegram-bot-api";
import { launchPuppeteer } from "../utils/puppeteer.js";
import { bot } from "../index.js";

// Разрешённые валюты на kursi.ge
const ALLOWED = new Set(["EUR", "GEL", "USD", "RUB"]);

type Parsed = {
  base: string;
  quote: string;
  amount: number;
  divisor?: number;
} | null;

function parseKursiArgs(text: string): Parsed {
  const m = text.match(
    /^\/ккурс\s+([^\s]+)(?:\s+([\d.,]+))?(?:\/([\d.,]+))?$/i
  );
  if (!m) return null;
  let pair = m[1].trim().replace("/", "").toUpperCase();
  if (pair.length < 6) return null;
  let base = pair.slice(0, 3);
  let quote = pair.slice(3);
  const amount = m[2]
    ? parseFloat(m[2].replace(/\s+/g, "").replace(",", "."))
    : 1;
  const divisor = m[3] ? parseFloat(m[3].replace(",", ".")) : undefined;
  if (!ALLOWED.has(base) || !ALLOWED.has(quote)) return null;
  return {
    base,
    quote,
    amount: isNaN(amount) ? 1 : amount,
    divisor: divisor && !isNaN(divisor) ? divisor : undefined,
  };
}

async function tryAcceptCookies(page: any): Promise<void> {
  try {
    // Небольшая пауза, чтобы баннер успел смонтироваться
    await page.waitForTimeout(500);
    const btn = await page.$(
      "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll"
    );
    if (btn) {
      await btn.evaluate((el: any) =>
        (el as HTMLButtonElement).scrollIntoView({ block: "center" })
      );
      await btn.click({ delay: 20 });
      await page.waitForTimeout(300);
    }
    // Фолбэк: кликаем через evaluate, если элемент перекрыт
    await page.evaluate(() => {
      const el = document.getElementById(
        "CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll"
      ) as HTMLButtonElement | null;
      if (el) el.click();
    });
    await page.waitForTimeout(200);
  } catch {
    // Игнорируем — если баннера нет
  }
}

export const kursiRateModule = async (msg: Message): Promise<void> => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() || "";

  // Информация о расширенном выражении (для добавления в caption скрина)
  let calcInfo:
    | {
        lines: string[];
        exprDisplay: string;
        finalFormatted: string;
      }
    | null = null;

  // Новый формат для /ккурс по аналогии с /курс:
  //   /ккурс gelusd (100000/0,991+100) - gelusd (100000/0,993+100)
  //   /ккурс gelusd 3500-117000-150000-20000-100000
  //
  // ВАЖНО: если команда уже подходит под стандартный формат
  // /ккурс <пара> [сумма][/делитель] (например: /ккурс usdgel 15000/1,02),
  // то расширенный режим НЕ включаем — пусть отрабатывает обычная логика
  // с amount и divisor.
  const calcMatch = text.match(/^\/ккурс\s+(.+)$/i);
  if (calcMatch && !parseKursiArgs(text)) {
    const exprPart = calcMatch[1].replace(/,/g, ".").replace(/[–—−]/g, "-");

    // 1) Блоки вида "<пара> (выражение)"
    const complexRegex = /([a-z]{3,10})\s*\(([^()]+)\)/gi;
    // 2) Блоки вида "<пара> <число><операции...>"
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

        const parsed = parseKursiArgs(`/ккурс ${pairRaw} ${amount}`);
        if (!parsed) {
          await bot.sendMessage(chatId, `❌ Неверная или запрещённая валютная пара: ${pairRaw}.`);
          return;
        }
        const { base, quote } = parsed;

        segments.push({
          full,
          placeholder: `__K${placeholderIndex++}__`,
          base,
          quote,
          amount,
          converted: amount, // временно, конвертация ниже
        });
      }

      // Обрабатываем простые блоки "<пара> 3500-117000-150000"
      for (const m of simpleMatches) {
        const full = m[0];
        const pairRaw = m[1];
        const expr = m[2];

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

        const parsed = parseKursiArgs(`/ккурс ${pairRaw} ${amount}`);
        if (!parsed) {
          await bot.sendMessage(chatId, `❌ Неверная или запрещённая валютная пара: ${pairRaw}.`);
          return;
        }
        const { base, quote } = parsed;

        segments.push({
          full,
          placeholder: `__K${placeholderIndex++}__`,
          base,
          quote,
          amount,
          converted: amount,
        });
      }

      // Если удалось найти хотя бы один сегмент — считаем, что это расширенный режим.
      if (segments.length > 0) {
        // Для kursi.ge мы не вытаскиваем конвертацию для каждого сегмента отдельно,
        // так как UI заточен на одну пару за раз. Поэтому:
        //  - проверяем, что все пары одинаковые
        //  - считаем суммарную amount по всем сегментам и используем штатный механизм ниже
        const baseSet = new Set(segments.map((s) => s.base));
        const quoteSet = new Set(segments.map((s) => s.quote));
        if (baseSet.size !== 1 || quoteSet.size !== 1) {
          await bot.sendMessage(
            chatId,
            "❌ Для /ккурс в одном выражении должна использоваться одна и та же валютная пара."
          );
          return;
        }

        const totalAmount = segments.reduce((sum, s) => sum + s.amount, 0);

        // Собираем итоговое арифметическое выражение (без пары) ради красоты вывода
        let exprForCalc = exprPart;
        for (const seg of segments) {
          exprForCalc = exprForCalc.replace(seg.full, seg.amount.toString());
        }
        const safeFinal = exprForCalc.replace(/[^0-9+\-*/().\s]/g, "");
        const finalAmount = Function(`"use strict"; return (${safeFinal})`)();
        if (isNaN(finalAmount)) {
          await bot.sendMessage(chatId, "❌ Не удалось вычислить выражение.");
          return;
        }

        const base = [...baseSet][0];
        const quote = [...quoteSet][0];

        // Подменяем text так, чтобы ниже сработал стандартный путь: одна пара + amount
        const syntheticText = `/ккурс ${base.toLowerCase()}${quote.toLowerCase()} ${totalAmount}`;
        (msg as any).text = syntheticText;

        const formattedLines = segments.map((s) => {
          const a = Number(s.amount.toFixed(6)).toLocaleString("ru-RU");
          return `${a} ${s.base} → ${s.quote}`;
        });

        calcInfo = {
          lines: formattedLines,
          exprDisplay: exprForCalc.replace(/\s+/g, ""),
          finalFormatted: Number(finalAmount.toFixed(6)).toLocaleString("ru-RU"),
        };
      }
  }

  const parsed = parseKursiArgs((msg as any).text ?? text);
  if (!parsed) {
    await bot.sendMessage(
      chatId,
      "⚙️ Формат: /ккурс <пара> [сумма][/делитель]\nПримеры: /ккурс gelusd 100, /ккурс gelusd 10000/1,015\nДопустимые валюты: EUR, GEL, USD, RUB"
    );
    return;
  }

  const { base, quote, amount, divisor } = parsed;

  const url = `https://kursi.ge/en/`;

  console.log(`[kursi] Начало обработки /ккурс: ${base} → ${quote}, сумма: ${amount}, делитель: ${divisor}`);

  let browser: any = null;
  try {
    browser = await launchPuppeteer();
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    // Desktop user-agent для ПК-версии сайта
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
    );

    console.log(`[kursi] Переход на страницу: ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    console.log(`[kursi] Страница загружена`);

    // Принять cookies, если баннер есть
    console.log(`[kursi] Попытка принять cookies...`);
    await tryAcceptCookies(page);
    console.log(`[kursi] Cookies обработаны`);

    // Вспомогательные функции для ПК-версии: открыть выпадающий список по метке и выбрать валюту
    const openDropdownByLabel = async (labelText: 'From' | 'To') => {
      const opened = await page.evaluate((label) => {
        const spans = Array.from(
          document.querySelectorAll('span.text-gray-300.uppercase.text-sm.font-noto')
        );
        const target = spans.find(
          (s) => (s.textContent || '').trim().toLowerCase() === label.toLowerCase()
        );
        if (!target) return false;
        const container = target.closest('div.relative');
        if (!container) return false;
        const btn = container.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement | null;
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      }, labelText);
      if (!opened) {
        // Резерв: XPath по тексту метки
        const [spanNode] = await page.$x(`//span[normalize-space(.)='${labelText}']`);
        if (spanNode) {
          const rel = await (spanNode as any).evaluateHandle((el: Element) => el.closest('div[contains(@class,"relative")]'));
          const btn = await page.evaluateHandle((el: Element | null) => el ? el.querySelector('button[aria-haspopup="menu"]') : null, rel);
          if (btn) {
            await (btn as any).click({ delay: 20 });
          }
        }
      }
      await page.waitForTimeout(200);
    };

    const selectCurrencyFromMenu = async (code: string) => {
      await page.waitForSelector('button[role="menuitem"]', { timeout: 5000 }).catch(() => null);
      const selected = await page.evaluate((currency) => {
        const items = Array.from(document.querySelectorAll('button[role="menuitem"]')) as HTMLButtonElement[];
        const item = items.find((b) => (b.textContent || '').toUpperCase().includes(currency.toUpperCase()));
        if (item) {
          item.click();
          return true;
        }
        return false;
      }, code);
      if (!selected) {
        // Резервный XPath
        const [node] = await page.$x(`//button[@role='menuitem'][contains(., '${code}')]`);
        if (node) await (node as any).click({ delay: 20 });
      }
      await page.waitForTimeout(200);
    };

    const setFromAmount = async (val: number) => {
      // Ищем поле ввода по метке "From" и устанавливаем значение
      const result = await page.evaluate((amount) => {
        const spans = Array.from(
          document.querySelectorAll('span.text-gray-300.uppercase.text-sm.font-noto')
        );
        const fromSpan = spans.find((s) => (s.textContent || '').trim() === 'From');
        if (!fromSpan) return { found: false, error: 'From span not found' };
        
        // Ищем родительский div.relative, который содержит input
        const container = fromSpan.closest('div.relative');
        if (!container) return { found: false, error: 'Container not found' };
        
        const input = container.querySelector('input[placeholder="0.00"]') as HTMLInputElement | null;
        if (!input) return { found: false, error: 'Input not found' };
        
        // Для React controlled inputs используем нативный setter
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        
        // Фокус на input
        input.focus();
        input.click();
        
        // Устанавливаем значение через нативный setter (для React controlled inputs)
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(input, String(amount));
        } else {
          input.value = String(amount);
        }
        
        // Триггерим события для React
        const inputEvent = new Event('input', { bubbles: true, cancelable: true });
        const changeEvent = new Event('change', { bubbles: true, cancelable: true });
        
        input.dispatchEvent(inputEvent);
        input.dispatchEvent(changeEvent);
        
        // Также пробуем через InputEvent (более правильный способ для React)
        const inputEvent2 = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: String(amount)
        });
        input.dispatchEvent(inputEvent2);
        
        // Снимаем фокус
        input.blur();
        const blurEvent = new Event('blur', { bubbles: true, cancelable: true });
        input.dispatchEvent(blurEvent);
        
        return { found: true, value: input.value, setterUsed: !!nativeInputValueSetter };
      }, val);
      
      console.log(`[kursi setFromAmount] Результат установки значения:`, result);
      
      // Дополнительная задержка для обновления UI и вычисления поля To
      await page.waitForTimeout(2000);
    };

    // 1) Выбираем валюту "From" = base (пример: GEL)
    console.log(`[kursi] Выбор валюты From: ${base}`);
    await openDropdownByLabel('From');
    await selectCurrencyFromMenu(base);
    console.log(`[kursi] Валюта From выбрана: ${base}`);

    // 2) Выбираем валюту "To" = quote (пример: USD)
    console.log(`[kursi] Выбор валюты To: ${quote}`);
    await openDropdownByLabel('To');
    await selectCurrencyFromMenu(quote);
    console.log(`[kursi] Валюта To выбрана: ${quote}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    // 3) Устанавливаем сумму в поле "From" (пример: 100)
    console.log(`[kursi] Установка суммы в поле From: ${amount}`);
    await setFromAmount(amount);
    
    // Проверяем, что значение действительно установлено
    const fromValueCheck = await page.evaluate(() => {
      const spans = Array.from(
        document.querySelectorAll('span.text-gray-300.uppercase.text-sm.font-noto')
      );
      const fromSpan = spans.find((s) => (s.textContent || '').trim() === 'From');
      const container = fromSpan?.closest('div.relative');
      const input = container?.querySelector('input[placeholder="0.00"]') as HTMLInputElement | null;
      return {
        found: !!input,
        value: input?.value || null
      };
    });
    console.log(`[kursi] Проверка значения поля From после ввода:`, fromValueCheck);
    
    console.log(`[kursi] Сумма установлена`);
    // Ждем, пока поле "To" заполнится (значение > 0)
    console.log(`[kursi] Ожидание заполнения поля To...`);
    
    // Сначала проверяем, что поле существует
    const toFieldExists = await page.evaluate(() => {
      const spans = Array.from(
        document.querySelectorAll('span.text-gray-300.uppercase.text-sm.font-noto')
      );
      const toSpan = spans.find((s) => (s.textContent || '').trim() === 'To');
      const container = toSpan?.closest('div.relative');
      const input = container?.querySelector('input[placeholder="0.00"]') as HTMLInputElement | null;
      return {
        found: !!input,
        value: input?.value || null
      };
    });
    console.log(`[kursi] Проверка поля To до ожидания:`, toFieldExists);
    
    try {
      await page.waitForFunction(() => {
        const spans = Array.from(
          document.querySelectorAll('span.text-gray-300.uppercase.text-sm.font-noto')
        );
        const toSpan = spans.find((s) => (s.textContent || '').trim() === 'To');
        const container = toSpan?.closest('div.relative');
        const input = container?.querySelector('input[placeholder="0.00"]') as HTMLInputElement | null;
        if (!input) return false;
        const raw = (input.value || '').replace(/\s+/g, '').replace(',', '.');
        const num = parseFloat(raw);
        return !isNaN(num) && num > 0;
      }, { timeout: 15000, polling: 500 });
      console.log(`[kursi] Поле To заполнено`);
    } catch (e) {
      console.error(`[kursi] ОШИБКА: Поле To не заполнилось за 15 секунд:`, e);
      // Проверяем текущее значение для отладки
      const debugValue = await page.evaluate(() => {
        const spans = Array.from(
          document.querySelectorAll('span.text-gray-300.uppercase.text-sm.font-noto')
        );
        const toSpan = spans.find((s) => (s.textContent || '').trim() === 'To');
        const container = toSpan?.closest('div.relative');
        const input = container?.querySelector('input[placeholder="0.00"]') as HTMLInputElement | null;
        return {
          found: !!input,
          value: input?.value || null,
          placeholder: input?.placeholder || null
        };
      });
      console.log(`[kursi] Отладочная информация поля To:`, debugValue);
    }
    // Закрываем модальное окно "Exchange currency and win!", если оно открыто
    console.log(`[kursi] Попытка закрыть модальное окно...`);
    try {
      await page.waitForTimeout(1000); // Ждем появления модального окна
      const closeModal = await page.evaluate(() => {
        // Ищем кнопку "Dont show again" в модальном окне
        const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
        const dontShowButton = buttons.find((btn) => 
          btn.textContent?.trim().toLowerCase().includes('dont show again') ||
          btn.textContent?.trim().toLowerCase().includes("don't show again")
        );
        if (dontShowButton) {
          dontShowButton.click();
          return true;
        }
        return false;
      });
      if (closeModal) {
        console.log(`[kursi] Модальное окно закрыто`);
        await page.waitForTimeout(500);
      } else {
        console.log(`[kursi] Модальное окно не найдено или уже закрыто`);
      }
    } catch (e) {
      console.log(`[kursi] Ошибка при закрытии модального окна (игнорируем):`, e);
    }
    // (убрано отправление второго сообщения — используем caption у фото)

    // Снимок карточки Convert без блока подсказок и кнопки Continue
    try {
      // Находим элемент карточки по заголовку "Convert"
      console.log(`[kursi] Поиск карточки Convert...`);
      const [cardHandle] = await page.$x(
        "//p[normalize-space(.)='Convert']/ancestor::div[contains(@class,'bg-primary-900')][1]"
      );
      if (cardHandle) {
        console.log(`[kursi] Карточка найдена, удаление лишних элементов...`);
        // Удаляем блок подсказок и кнопку Continue внутри карточки
        await (cardHandle as any).evaluate((el: Element) => {
          // Удалить контейнер с подсказками и кнопкой Continue (второй блок flex-col gap-6 с Continue)
          const allCols = Array.from(el.querySelectorAll('div.flex.flex-col.gap-6')) as HTMLElement[];
          for (const col of allCols) {
            const hasContinue = Array.from(col.querySelectorAll('button')).some((b) => (b.textContent || '').includes('Continue'));
            const hasSuggestions = !!col.querySelector('div.flex.gap-2.flex-wrap');
            if (hasContinue || hasSuggestions) {
              col.remove();
            }
          }
        });

        await page.waitForTimeout(100);
        console.log(`[kursi] Делаем скриншот...`);
        const buf = await (cardHandle as any).screenshot({ type: 'png' });
        console.log(`[kursi] Скриншот сделан, размер: ${buf.length} байт`);

        // Парсим значение поля To для подписи
        console.log(`[kursi] Парсинг значения поля To...`);
        const toValue = await page.evaluate(() => {
          const spans = Array.from(
            document.querySelectorAll('span.text-gray-300.uppercase.text-sm.font-noto')
          );
          const toSpan = spans.find((s) => (s.textContent || '').trim() === 'To');
          const container = toSpan?.closest('div.relative');
          const input = container?.querySelector('input[placeholder="0.00"]') as HTMLInputElement | null;
          return input ? input.value : null;
        });
        console.log(`[kursi] Значение поля To: ${toValue}`);

        // Формируем caption по шаблону ОДНИМ сообщением (включая расчёт с делителем)
        const formattedAmount = amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        let caption = `${formattedAmount} ${base} → ${quote}`;
        if (toValue) {
          // Правильно парсим число: если есть и запятая и точка, запятая - тысячи, точка - десятичные
          // Убираем пробелы, затем убираем запятые (разделители тысяч), оставляем точку
          let cleaned = toValue.replace(/\s+/g, '');
          if (cleaned.includes(',') && cleaned.includes('.')) {
            // Формат "3,691.40" - убираем запятые (тысячи), точка остается
            cleaned = cleaned.replace(/,/g, '');
          } else if (cleaned.includes(',')) {
            // Только запятая - может быть десятичный разделитель (европейский формат)
            cleaned = cleaned.replace(',', '.');
          }
          const num = parseFloat(cleaned);
          console.log(`[kursi] Распарсенное число из toValue: ${num}`);
          if (!isNaN(num) && amount > 0) {
            const formattedToTight = num.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const rateB2Q = num / amount; // 1 base в quote
            const rateQ2B = rateB2Q > 0 ? 1 / rateB2Q : 0; // 1 quote в base
            const rateB2QStr = rateB2Q.toLocaleString('ru-RU', { minimumFractionDigits: 6, maximumFractionDigits: 8 });
            const rateQ2BStr = rateQ2B.toLocaleString('ru-RU', { minimumFractionDigits: 6, maximumFractionDigits: 8 });

            console.log(`[kursi] Курсы: 1 ${base} = ${rateB2QStr} ${quote}, 1 ${quote} = ${rateQ2BStr} ${base}`);

            caption += `\n\n1 ${base} = ${rateB2QStr}${quote}`;
            caption += `\n1 ${quote} = ${rateQ2BStr} ${base}`;
            caption += `\n\n<code>${formattedToTight}</code>${quote}`;

            if (typeof divisor === 'number' && divisor > 0) {
              const finalAmount = num / divisor;
              const formattedFinal = finalAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              const convertedForFormula = num.toFixed(2).replace('.', ',');
              const divisorForFormula = String(divisor).replace('.', ',');
              caption += `\n\n📊Rate adjustment:\n`;
              caption += `<code>${convertedForFormula} / ${divisorForFormula} = ${formattedFinal}</code>`;
            }

            // Если это расширенный режим /ккурс с выражением – добавляем разбор
            if (calcInfo) {
              caption += `\n\n<code>${calcInfo.lines.join('\n')}</code>\n\n` +
                         `<code>${calcInfo.exprDisplay}</code> = <code>${calcInfo.finalFormatted}</code>`;
            }
          }
        }

        console.log(`[kursi] Отправка фото в чат...`);
        await bot.sendPhoto(chatId, buf as any, { caption, parse_mode: 'HTML' });
        console.log(`[kursi] Фото отправлено в чат`);
      } else {
        console.log(`[kursi] ОШИБКА: Карточка Convert не найдена`);
      }
    } catch (e) {
      console.error(`[kursi] ОШИБКА при создании скриншота:`, e);
      if (e instanceof Error) {
        console.error(`[kursi] Сообщение об ошибке: ${e.message}`);
        console.error(`[kursi] Stack: ${e.stack}`);
      }
    }

  } catch (e) {
    console.error(`[kursi] ОШИБКА:`, e);
    if (e instanceof Error) {
      console.error(`[kursi] Сообщение об ошибке: ${e.message}`);
      console.error(`[kursi] Stack: ${e.stack}`);
    }
  } finally {
    // Гарантируем закрытие браузера в любом случае
    if (browser) {
      try {
        if (browser.isConnected()) {
          await browser.close();
        }
      } catch (closeError) {
        console.error("/ккурс error при закрытии браузера:", closeError);
      }
    }
  }
}
