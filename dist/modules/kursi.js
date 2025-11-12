import { launchPuppeteer } from "../utils/puppeteer.js";
import { bot } from "../index.js";
// Разрешённые валюты на kursi.ge
const ALLOWED = new Set(["EUR", "GEL", "USD", "RUB"]);
function parseKursiArgs(text) {
    const m = text.match(/^\/ккурс\s+([^\s]+)(?:\s+([\d.,]+))?(?:\/([\d.,]+))?$/i);
    if (!m)
        return null;
    let pair = m[1].trim().replace("/", "").toUpperCase();
    if (pair.length < 6)
        return null;
    let base = pair.slice(0, 3);
    let quote = pair.slice(3);
    const amount = m[2]
        ? parseFloat(m[2].replace(/\s+/g, "").replace(",", "."))
        : 1;
    const divisor = m[3] ? parseFloat(m[3].replace(",", ".")) : undefined;
    if (!ALLOWED.has(base) || !ALLOWED.has(quote))
        return null;
    return {
        base,
        quote,
        amount: isNaN(amount) ? 1 : amount,
        divisor: divisor && !isNaN(divisor) ? divisor : undefined,
    };
}
async function tryAcceptCookies(page) {
    try {
        // Небольшая пауза, чтобы баннер успел смонтироваться
        await page.waitForTimeout(500);
        const btn = await page.$("#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll");
        if (btn) {
            await btn.evaluate((el) => el.scrollIntoView({ block: "center" }));
            await btn.click({ delay: 20 });
            await page.waitForTimeout(300);
        }
        // Фолбэк: кликаем через evaluate, если элемент перекрыт
        await page.evaluate(() => {
            const el = document.getElementById("CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll");
            if (el)
                el.click();
        });
        await page.waitForTimeout(200);
    }
    catch {
        // Игнорируем — если баннера нет
    }
}
export const kursiRateModule = async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim() || "";
    const parsed = parseKursiArgs(text);
    if (!parsed) {
        await bot.sendMessage(chatId, "⚙️ Формат: /ккурс <пара> [сумма][/делитель]\nПримеры: /ккурс gelusd 100, /ккурс gelusd 10000/1,015\nДопустимые валюты: EUR, GEL, USD, RUB");
        return;
    }
    const { base, quote, amount, divisor } = parsed;
    const url = `https://kursi.ge/en/`;
    let browser = null;
    try {
        browser = await launchPuppeteer();
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
        // Desktop user-agent для ПК-версии сайта
        await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36");
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
        // Принять cookies, если баннер есть
        await tryAcceptCookies(page);
        // Вспомогательные функции для ПК-версии: открыть выпадающий список по метке и выбрать валюту
        const openDropdownByLabel = async (labelText) => {
            const opened = await page.evaluate((label) => {
                const spans = Array.from(document.querySelectorAll('span.text-gray-300.uppercase.text-sm.font-noto'));
                const target = spans.find((s) => (s.textContent || '').trim().toLowerCase() === label.toLowerCase());
                if (!target)
                    return false;
                const container = target.closest('div.relative');
                if (!container)
                    return false;
                const btn = container.querySelector('button[aria-haspopup="menu"]');
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
                    const rel = await spanNode.evaluateHandle((el) => el.closest('div[contains(@class,"relative")]'));
                    const btn = await page.evaluateHandle((el) => el ? el.querySelector('button[aria-haspopup="menu"]') : null, rel);
                    if (btn) {
                        await btn.click({ delay: 20 });
                    }
                }
            }
            await page.waitForTimeout(200);
        };
        const selectCurrencyFromMenu = async (code) => {
            await page.waitForSelector('button[role="menuitem"]', { timeout: 5000 }).catch(() => null);
            const selected = await page.evaluate((currency) => {
                const items = Array.from(document.querySelectorAll('button[role="menuitem"]'));
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
                if (node)
                    await node.click({ delay: 20 });
            }
            await page.waitForTimeout(200);
        };
        const setFromAmount = async (val) => {
            // Ищем поле ввода по метке "From" и вводим через клавиатуру
            const [fromInput] = await page.$x("//span[normalize-space(.)='From']/ancestor::div[contains(@class,'relative')]//input[@placeholder='0.00']");
            if (fromInput) {
                // Фокус + выделение всего текста, затем стираем и печатаем значение
                await fromInput.focus();
                await fromInput.click({ clickCount: 3, delay: 20 });
                await page.keyboard.press('Backspace');
                await page.keyboard.type(String(val), { delay: 50 });
                // Снимаем фокус табом, чтобы сработали обработчики (onBlur/debounce)
                await page.keyboard.press('Tab');
            }
            await page.waitForTimeout(300);
        };
        // 1) Выбираем валюту "From" = base (пример: GEL)
        await openDropdownByLabel('From');
        await selectCurrencyFromMenu(base);
        // 2) Выбираем валюту "To" = quote (пример: USD)
        await openDropdownByLabel('To');
        await selectCurrencyFromMenu(quote);
        await new Promise(resolve => setTimeout(resolve, 1000));
        // 3) Устанавливаем сумму в поле "From" (пример: 100)
        await setFromAmount(amount);
        // Ждем, пока поле "To" заполнится (значение > 0)
        await page.waitForFunction(() => {
            const spans = Array.from(document.querySelectorAll('span.text-gray-300.uppercase.text-sm.font-noto'));
            const toSpan = spans.find((s) => (s.textContent || '').trim() === 'To');
            const container = toSpan?.closest('div.relative');
            const input = container?.querySelector('input[placeholder="0.00"]');
            if (!input)
                return false;
            const raw = (input.value || '').replace(/\s+/g, '').replace(',', '.');
            const num = parseFloat(raw);
            return !isNaN(num) && num > 0;
        }, { timeout: 5000 }).catch(() => null);
        // (убрано отправление второго сообщения — используем caption у фото)
        // Снимок карточки Convert без блока подсказок и кнопки Continue
        try {
            // Находим элемент карточки по заголовку "Convert"
            const [cardHandle] = await page.$x("//p[normalize-space(.)='Convert']/ancestor::div[contains(@class,'bg-primary-900')][1]");
            if (cardHandle) {
                // Удаляем блок подсказок и кнопку Continue внутри карточки
                await cardHandle.evaluate((el) => {
                    // Удалить контейнер с подсказками и кнопкой Continue (второй блок flex-col gap-6 с Continue)
                    const allCols = Array.from(el.querySelectorAll('div.flex.flex-col.gap-6'));
                    for (const col of allCols) {
                        const hasContinue = Array.from(col.querySelectorAll('button')).some((b) => (b.textContent || '').includes('Continue'));
                        const hasSuggestions = !!col.querySelector('div.flex.gap-2.flex-wrap');
                        if (hasContinue || hasSuggestions) {
                            col.remove();
                        }
                    }
                });
                await page.waitForTimeout(100);
                const buf = await cardHandle.screenshot({ type: 'png' });
                // Парсим значение поля To для подписи
                const toValue = await page.evaluate(() => {
                    const spans = Array.from(document.querySelectorAll('span.text-gray-300.uppercase.text-sm.font-noto'));
                    const toSpan = spans.find((s) => (s.textContent || '').trim() === 'To');
                    const container = toSpan?.closest('div.relative');
                    const input = container?.querySelector('input[placeholder="0.00"]');
                    return input ? input.value : null;
                });
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
                    }
                    else if (cleaned.includes(',')) {
                        // Только запятая - может быть десятичный разделитель (европейский формат)
                        cleaned = cleaned.replace(',', '.');
                    }
                    const num = parseFloat(cleaned);
                    if (!isNaN(num) && amount > 0) {
                        const formattedToTight = num.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        const rateB2Q = num / amount; // 1 base в quote
                        const rateQ2B = rateB2Q > 0 ? 1 / rateB2Q : 0; // 1 quote в base
                        const rateB2QStr = rateB2Q.toLocaleString('ru-RU', { minimumFractionDigits: 6, maximumFractionDigits: 8 });
                        const rateQ2BStr = rateQ2B.toLocaleString('ru-RU', { minimumFractionDigits: 6, maximumFractionDigits: 8 });
                        caption += `\n\n1 ${base} = ${rateB2QStr}${quote}`;
                        caption += `\n1 ${quote} = ${rateQ2BStr} ${base}`;
                        caption += `\n\n<code>${formattedToTight}</code>${quote}`;
                        if (typeof divisor === 'number' && divisor > 0) {
                            const finalAmount = num / divisor;
                            const formattedFinal = finalAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                            const convertedForFormula = num.toFixed(2).replace('.', ',');
                            const divisorForFormula = String(divisor).replace('.', ',');
                            caption += `\n\n📊Расчет с делителем ${divisorForFormula}:\n`;
                            caption += `<code>${convertedForFormula} / ${divisorForFormula} = ${formattedFinal}</code>`;
                        }
                    }
                }
                await bot.sendPhoto(chatId, buf, { caption, parse_mode: 'HTML' });
            }
        }
        catch { }
    }
    catch (e) {
        console.error("/ккурс error:", e);
    }
    finally {
        // Гарантируем закрытие браузера в любом случае
        if (browser) {
            try {
                if (browser.isConnected()) {
                    await browser.close();
                }
            }
            catch (closeError) {
                console.error("/ккурс error при закрытии браузера:", closeError);
            }
        }
    }
};
