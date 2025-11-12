import puppeteer from "puppeteer-core";
import { execSync } from "child_process";
import { existsSync } from "fs";
function findBrowserExecutable() {
    // Если путь указан в переменной окружения, используем его
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        if (existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
            return process.env.PUPPETEER_EXECUTABLE_PATH;
        }
        throw new Error(`PUPPETEER_EXECUTABLE_PATH указан, но файл не найден: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
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
    // Проверяем каждый путь
    for (const path of possiblePaths) {
        if (existsSync(path)) {
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
    try {
        console.log(`[Puppeteer] Начало поиска браузера...`);
        console.log(`[Puppeteer] PUPPETEER_EXECUTABLE_PATH: ${process.env.PUPPETEER_EXECUTABLE_PATH || "не установлен"}`);
        const executablePath = findBrowserExecutable();
        console.log(`[Puppeteer] ✓ Найден браузер: ${executablePath}`);
        console.log(`[Puppeteer] Проверка существования файла: ${existsSync(executablePath) ? "✓ существует" : "✗ не существует"}`);
        const browser = await puppeteer.launch({
            executablePath,
            headless: "new",
            userDataDir: "/tmp/puppeteer-profile",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no-zygote",
                "--single-process",
                "--disable-extensions",
                "--disable-background-networking",
            ],
            env: {
                ...process.env,
                PUPPETEER_CACHE_DIR: "/dev/null",
                PUPPETEER_SKIP_DOWNLOAD: "true",
            },
        });
        console.log(`[Puppeteer] ✓ Браузер успешно запущен`);
        return browser;
    }
    catch (error) {
        console.error(`[Puppeteer] ✗ Ошибка запуска браузера:`, error);
        throw error;
    }
}
