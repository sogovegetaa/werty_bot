import "dotenv/config";
import TelegramBot, { Message } from "node-telegram-bot-api";
import { commandHandlers } from "./commands.js";
import { walletAdjustModule } from "./modules/wallet-adjust.js";
import { sendReportXls } from "./modules/report.js";
import { sendOrdersReportXls } from "./modules/orders-report.js";

const token = process.env.BOT_TOKEN!;

console.log("[Bot] Инициализация бота...");
console.log(`[Bot] PUPPETEER_EXECUTABLE_PATH: ${process.env.PUPPETEER_EXECUTABLE_PATH || "не установлен"}`);

export const bot = new TelegramBot(token, { polling: true });

console.log("[Bot] ✓ Бот инициализирован, запускается polling...");

// Graceful shutdown - корректное завершение polling при остановке процесса
let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("\n[Shutdown] Получен сигнал завершения, останавливаю бота...");

  try {
    // Останавливаем polling
    await bot.stopPolling();
    console.log("[Shutdown] Polling остановлен");
  } catch (error) {
    console.error("[Shutdown] Ошибка при остановке polling:", error);
  }

  process.exit(0);
}

// Обработка сигналов завершения процесса
process.on("SIGINT", shutdown); // Ctrl+C
process.on("SIGTERM", shutdown); // PM2 stop, systemd stop и т.д.
process.on("SIGUSR2", shutdown); // Nodemon restart

console.log("[Bot] ✓ Обработчики сигналов установлены");

// Обработка ошибок polling
bot.on("polling_error", (error) => {
  // Игнорируем ошибки 409 (конфликт), если это происходит при завершении
  if (isShuttingDown) {
    return;
  }

  console.error("[Polling Error]", error);

  // Если это конфликт 409, предупреждаем пользователя
  // @ts-ignore
  if (error.code === "ETELEGRAM" && error.message?.includes("409")) {
    console.error(
      "\n⚠️  ВНИМАНИЕ: Обнаружен конфликт polling (409). " +
        "Убедитесь, что запущен только один экземпляр бота.\n" +
        "Проверьте:\n" +
        "  - PM2 процессы: pm2 list\n" +
        "  - Локальные процессы: ps aux | grep node\n" +
        "  - Другие запущенные экземпляры бота\n"
    );
  }
});

bot.setMyCommands([
  { command: "start", description: "Начать работу с ботом" },
  { command: "help", description: "Помощь по командам" },
]);

bot.on("message", async (msg: Message): Promise<void> => {
  const text = msg.text?.trim() || "";
  const command = text.split(/\s+/)[0];
  const handler = commandHandlers[command];
  if (handler) {
    await handler(msg);
    return;
  }
  // Калькулятор: команды вида "/<выражение>" (начинается с цифры или скобки)
  if (/^\/[0-9(]/.test(command)) {
    // используем существующий calcModule, он поддерживает прямой формат
    const { calcModule } = await import("./modules/calc.js");
    await calcModule(msg);
    return;
  }
  if (/^\/[\p{L}]{2,8}\b/u.test(command)) {
    await walletAdjustModule(msg);
  }
});

bot.on("callback_query", async (q) => {
  try {
    if (q.data === "report_xls") {
      if (q.message)
        await sendReportXls(q.message, {
          telegramId: q.from.id,
          username: q.from.username || undefined,
        });
    }
    if (q.data?.startsWith("report_xls:code:")) {
      const code = q.data.split(":")[2];
      if (q.message)
        await sendReportXls(
          q.message,
          { telegramId: q.from.id, username: q.from.username || undefined },
          code
        );
    }
    if (q.data?.startsWith("orders_xls:")) {
      const scope = q.data.split(":")[1] === "all" ? "all" : "mine";
      if (q.message)
        await sendOrdersReportXls(q.message, scope as any, {
          telegramId: q.from.id,
          username: q.from.username || undefined,
        });
    }
    if (q.id) await bot.answerCallbackQuery(q.id);
  } catch (e) {
    console.error("callback handler error:", e);
  }
});
