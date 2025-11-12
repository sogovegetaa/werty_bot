import puppeteer from 'puppeteer-core';
import fs from 'fs';

export async function launchPuppeteer() {
  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';

  if (!fs.existsSync(executablePath)) {
    throw new Error(`Chromium not found at ${executablePath}`);
  }

  console.log(`[Puppeteer] Using Chromium at: ${executablePath}`);

  return await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
    ],
    // Важно: полностью блокируем любые попытки использовать встроенный кэш Puppeteer
    userDataDir: '/tmp/puppeteer-profile',
  });
}
