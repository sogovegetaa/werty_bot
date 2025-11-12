import puppeteer from "puppeteer-core";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export async function launchPuppeteer() {
  const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const userDataDir = join(tmpdir(), `puppeteer-profile-${uniqueId}`);
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || "/snap/bin/chromium";
  
  try {
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
      if (isClosing) return;
      isClosing = true;
      
      try {
        await originalClose();
      } finally {
        try {
          rmSync(userDataDir, { recursive: true, force: true });
        } catch {
          // Игнорируем ошибки очистки
        }
      }
    };

    return browser;
  } catch (error) {
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Игнорируем ошибки очистки
    }
    throw error;
  }
}
