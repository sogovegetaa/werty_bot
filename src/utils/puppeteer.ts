import puppeteer, { type PuppeteerLaunchOptions } from "puppeteer";
import { existsSync } from "fs";

/**
 * Запускает Puppeteer с правильной конфигурацией для сервера
 * Всегда использует системный Chromium для работы на сервере
 */
export async function launchPuppeteer() {
  // Запрещаем Puppeteer загружать свой Chrome
  process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = "true";
  process.env.PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser";
  
  // Принудительно используем системный Chromium
  // Сначала проверяем переменную окружения, затем дефолтный путь
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  
  // Если переменная не установлена или файл не существует, используем дефолтный путь
  if (!executablePath || !existsSync(executablePath)) {
    executablePath = "/usr/bin/chromium-browser";
    process.env.PUPPETEER_EXECUTABLE_PATH = executablePath;
  }
  
  // Проверяем существование файла
  if (!existsSync(executablePath)) {
    console.error(`[Puppeteer] ERROR: Chromium not found at: ${executablePath}`);
    console.error(`[Puppeteer] Please install Chromium: sudo apt install -y chromium-browser`);
    throw new Error(`Chromium executable not found at: ${executablePath}. Please install Chromium.`);
  }
  
  console.log(`[Puppeteer] Using Chromium at: ${executablePath}`);
  console.log(`[Puppeteer] PUPPETEER_EXECUTABLE_PATH=${process.env.PUPPETEER_EXECUTABLE_PATH}`);
  
  const launchOptions: any = {
    headless: true,
    executablePath: executablePath,
    ignoreDefaultArgs: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
  };

  try {
    const browser = await puppeteer.launch(launchOptions);
    console.log(`[Puppeteer] Browser launched successfully`);
    return browser;
  } catch (error: any) {
    console.error(`[Puppeteer] Failed to launch browser:`, error.message);
    console.error(`[Puppeteer] Executable path: ${executablePath}`);
    console.error(`[Puppeteer] Check if Chromium is installed: which chromium-browser`);
    throw error;
  }
}
