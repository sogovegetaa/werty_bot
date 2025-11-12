module.exports = {
  apps: [
    {
      name: "kesha-bot",
      script: "dist/index.js",
      env: {
        NODE_ENV: "production",
        PUPPETEER_EXECUTABLE_PATH: "/snap/bin/chromium",
        PUPPETEER_CACHE_DIR: "/dev/null",
        PUPPETEER_SKIP_DOWNLOAD: "true",
        LD_LIBRARY_PATH: "/usr/lib/x86_64-linux-gnu",
      },
    },
  ],
};

