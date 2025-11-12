import puppeteer from "puppeteer-core";

export async function launchPuppeteer() {
  const browser = await puppeteer.launch({
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser",
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

  console.log(
    `[Puppeteer] Using Chromium at: ${
      process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser"
    }`
  );

  return browser;
}
