import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
function findBrowserExecutable() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
        if (existsSync(envPath)) {
            return envPath;
        }
        throw new Error(`PUPPETEER_EXECUTABLE_PATH указан как "${envPath}", но файл не найден`);
    }
    const defaultPath = "/snap/bin/chromium";
    if (existsSync(defaultPath)) {
        return defaultPath;
    }
    throw new Error(`Браузер не найден. Установите Chromium: sudo snap install chromium, либо укажите путь в переменной окружения PUPPETEER_EXECUTABLE_PATH`);
}
export async function launchPuppeteer() {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const userDataDir = join(tmpdir(), `puppeteer-profile-${uniqueId}`);
    try {
        const executablePath = findBrowserExecutable();
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
        let isClosing = false;
        const originalClose = browser.close.bind(browser);
        browser.close = async () => {
            if (isClosing)
                return;
            isClosing = true;
            try {
                await originalClose();
            }
            finally {
                try {
                    rmSync(userDataDir, { recursive: true, force: true });
                }
                catch {
                    // Игнорируем ошибки очистки
                }
            }
        };
        return browser;
    }
    catch (error) {
        try {
            if (existsSync(userDataDir)) {
                rmSync(userDataDir, { recursive: true, force: true });
            }
        }
        catch {
            // Игнорируем ошибки очистки
        }
        throw error;
    }
}
