import puppeteer from "puppeteer-core";
import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
function findBrowserExecutable() {
    // Если путь указан в переменной окружения, используем его и проверяем строго
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
        console.log(`[Puppeteer] Проверка пути из переменной окружения: ${envPath}`);
        if (existsSync(envPath)) {
            console.log(`[Puppeteer] ✓ Файл существует: ${envPath}`);
            return envPath;
        }
        console.error(`[Puppeteer] ✗ Файл НЕ существует: ${envPath}`);
        throw new Error(`PUPPETEER_EXECUTABLE_PATH указан как "${envPath}", но файл не найден!\n` +
            `Проверьте, что файл существует: ls -la ${envPath}\n` +
            `Если Chromium установлен через snap, убедитесь, что он доступен: which chromium`);
    }
    // Возможные пути к браузерам
    const possiblePaths = [
        // Linux (Ubuntu/Debian)
        "/snap/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        // macOS
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        // Альтернативные пути Linux
        "/opt/google/chrome/chrome",
        "/usr/local/bin/chromium",
    ];
    // Проверяем каждый путь с логированием
    console.log(`[Puppeteer] Поиск браузера в стандартных путях...`);
    for (const path of possiblePaths) {
        console.log(`[Puppeteer] Проверка: ${path} - ${existsSync(path) ? "✓ существует" : "✗ не найден"}`);
        if (existsSync(path)) {
            console.log(`[Puppeteer] ✓ Найден браузер: ${path}`);
            return path;
        }
    }
    // Пытаемся найти через which команду (Linux/macOS)
    try {
        const commands = ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"];
        for (const cmd of commands) {
            try {
                const path = execSync(`which ${cmd}`, { encoding: "utf-8" }).trim();
                if (path && existsSync(path)) {
                    return path;
                }
            }
            catch {
                // Команда не найдена, продолжаем
            }
        }
    }
    catch {
        // which команда недоступна, продолжаем
    }
    // Если ничего не найдено, выдаем понятную ошибку
    throw new Error(`Браузер не найден. Пожалуйста, установите Chromium или Chrome, либо укажите путь в переменной окружения PUPPETEER_EXECUTABLE_PATH.\n` +
        `Для Ubuntu: sudo snap install chromium\n` +
        `Для macOS: установите Google Chrome из браузера\n` +
        `Проверенные пути: ${possiblePaths.join(", ")}`);
}
export async function launchPuppeteer() {
    // Создаем уникальный временный каталог для каждого запуска браузера
    // Это решает проблему с SingletonLock, когда несколько экземпляров пытаются использовать один userDataDir
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const userDataDir = join(tmpdir(), `puppeteer-profile-${uniqueId}`);
    try {
        console.log(`[Puppeteer] Начало поиска браузера...`);
        console.log(`[Puppeteer] PUPPETEER_EXECUTABLE_PATH: ${process.env.PUPPETEER_EXECUTABLE_PATH || "не установлен"}`);
        const executablePath = findBrowserExecutable();
        console.log(`[Puppeteer] ✓ Найден браузер: ${executablePath}`);
        console.log(`[Puppeteer] Проверка существования файла: ${existsSync(executablePath) ? "✓ существует" : "✗ не существует"}`);
        console.log(`[Puppeteer] Используется уникальный userDataDir: ${userDataDir}`);
        // Создаем временный каталог
        mkdirSync(userDataDir, { recursive: true });
        const browser = await puppeteer.launch({
            executablePath,
            headless: "new",
            userDataDir,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no-zygote",
                "--single-process",
                "--disable-extensions",
                "--disable-background-networking",
                "--disable-blink-features=AutomationControlled",
            ],
            env: {
                ...process.env,
                PUPPETEER_CACHE_DIR: "/dev/null",
                PUPPETEER_SKIP_DOWNLOAD: "true",
            },
        });
        console.log(`[Puppeteer] ✓ Браузер успешно запущен`);
        // Переопределяем метод close для автоматической очистки временного каталога
        // Защита от множественных вызовов close()
        let isClosing = false;
        const originalClose = browser.close.bind(browser);
        browser.close = async () => {
            if (isClosing) {
                console.log(`[Puppeteer] ⚠️ Браузер уже закрывается, пропускаем повторный вызов`);
                return;
            }
            isClosing = true;
            try {
                await originalClose();
                // Удаляем временный каталог после закрытия браузера
                try {
                    rmSync(userDataDir, { recursive: true, force: true });
                    console.log(`[Puppeteer] ✓ Временный каталог удален: ${userDataDir}`);
                }
                catch (cleanupError) {
                    console.warn(`[Puppeteer] ⚠️ Не удалось удалить временный каталог: ${userDataDir}`, cleanupError);
                }
            }
            catch (error) {
                console.error(`[Puppeteer] ✗ Ошибка при закрытии браузера:`, error);
                // Все равно пытаемся удалить временный каталог
                try {
                    rmSync(userDataDir, { recursive: true, force: true });
                }
                catch (cleanupError) {
                    // Игнорируем ошибки очистки
                }
                throw error;
            }
        };
        return browser;
    }
    catch (error) {
        // Удаляем временный каталог в случае ошибки
        try {
            if (existsSync(userDataDir)) {
                rmSync(userDataDir, { recursive: true, force: true });
            }
        }
        catch (cleanupError) {
            // Игнорируем ошибки очистки
        }
        console.error(`[Puppeteer] ✗ Ошибка запуска браузера:`, error);
        throw error;
    }
}
