import puppeteer from 'puppeteer';

export async function launchPuppeteer() {
  const browser = await puppeteer.launch({
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
    ],
  });

  console.log(
    `[Puppeteer] Using Chromium at: ${
      process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser'
    }`,
  );

  return browser;
}
