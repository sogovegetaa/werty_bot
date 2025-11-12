import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import { commandHandlers } from "./commands.js";
import { walletAdjustModule } from "./modules/wallet-adjust.js";
import { sendReportXls } from "./modules/report.js";
import { sendOrdersReportXls } from "./modules/orders-report.js";
const token = process.env.BOT_TOKEN;
export const bot = new TelegramBot(token, { polling: true });
bot.setMyCommands([
    { command: "start", description: "Начать работу с ботом" },
    { command: "help", description: "Помощь по командам" },
]);
bot.on("message", async (msg) => {
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
                await sendReportXls(q.message, { telegramId: q.from.id, username: q.from.username || undefined }, code);
        }
        if (q.data?.startsWith("orders_xls:")) {
            const scope = q.data.split(":")[1] === "all" ? "all" : "mine";
            if (q.message)
                await sendOrdersReportXls(q.message, scope, {
                    telegramId: q.from.id,
                    username: q.from.username || undefined,
                });
        }
        if (q.id)
            await bot.answerCallbackQuery(q.id);
    }
    catch (e) {
        console.error("callback handler error:", e);
    }
});
