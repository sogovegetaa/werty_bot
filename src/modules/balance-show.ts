import { Message } from "node-telegram-bot-api";
import { bot } from "../index.js";
import { supabase } from "../api.js";
import { formatWithApostrophe } from "../utils/format.js";
export const balanceShowModule = async (msg: Message): Promise<void> => {
    const chatId = msg.chat.id;
    const telegramId = msg.from!.id;
    const text = msg.text?.trim() || "";
    const m = text.match(/^\/дай(?:\s+([\p{L}A-Za-z]{2,16}))?$/u);
    const requestedCode = m && m[1] ? m[1].toLowerCase() : undefined;
    try {
        const { data: user, error: userError } = await supabase
            .from("user")
            .select("id, username")
            .eq("telegram_id", telegramId)
            .single();
        if (userError || !user) {
            await bot.sendMessage(chatId, "❌ Сначала напиши /start, чтобы зарегистрироваться.");
            return;
        }
        const { data: walletSettings } = await supabase
            .from("wallet")
            .select("code, precision")
            .eq("chat_id", chatId);
        const { data: transactions } = await supabase
            .from("wallet_tx")
            .select("code, amount")
            .eq("chat_id", chatId);
        const balancesByCode: Record<string, number> = {};
        if (transactions) {
            for (const tx of transactions) {
                const code = tx.code.toLowerCase();
                balancesByCode[code] = (balancesByCode[code] || 0) + Number(tx.amount || 0);
            }
        }
        const accounts: Array<{
            code: string;
            balance: number;
            precision: number;
        }> = [];
        if (walletSettings && walletSettings.length > 0) {
            for (const wallet of walletSettings) {
                const code = wallet.code.toLowerCase();
                accounts.push({
                    code,
                    balance: balancesByCode[code] || 0,
                    precision: wallet.precision || 2,
                });
            }
        }
        accounts.sort((a, b) => a.code.localeCompare(b.code));
        const lines = accounts.map((a) => {
            const formatted = formatWithApostrophe(Number(a.balance || 0), a.precision || 2);
            return ` <code>${formatted}</code> ${a.code}`;
        });
        const balancesBlock = lines.length
            ? lines.join("\n")
            : "Пока нет ни одного счёта. Создайте счёт командой /добавь &lt;код&gt;.";
        const message = `Средств на руках у неизвестного:\n\n` +
            balancesBlock +
            `\n\nЕсли нужна выписка по одному счёту: напишите /дай &lt;код&gt; и нажмите нужную кнопку.`;
        let buttons: any[] = [[{ text: "Полная выписка", callback_data: "report_xls" }]];
        if (requestedCode && accounts) {
            const target = accounts.find((a) => a.code.toLowerCase() === requestedCode);
            if (target) {
                buttons = [[{ text: `XLS: ${target.code}`, callback_data: `report_xls:code:${target.code}` }]];
            }
        }
        await bot.sendMessage(chatId, message, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: buttons },
        });
    }
    catch (err) {
        console.error("Ошибка в /дай:", err);
        bot.sendMessage(chatId, "⚠️ Ошибка при получении данных.");
    }
};
