import { bot } from "../index.js";
import { supabase } from "../api.js";
export const sendReportXls = async (msg, overrideUser, codeFilter) => {
    const chatId = msg.chat.id;
    try {
        const ExcelJS = (await import("exceljs")).default;
        const telegramId = overrideUser?.telegramId ?? msg.from.id;
        const usernameOverride = overrideUser?.username;
        const { data: user } = await supabase
            .from("user")
            .select("id, username")
            .eq("telegram_id", telegramId)
            .single();
        if (!user) {
            await bot.sendMessage(chatId, "❌ Сначала зарегистрируйся через /start.");
            return;
        }
        let txQuery = supabase
            .from("wallet_tx")
            .select("created_at, code, amount, balance_after, chat_title, username")
            .eq("user_id", user.id)
            .eq("chat_id", chatId)
            .order("created_at", { ascending: true });
        if (codeFilter)
            txQuery = txQuery.eq("code", codeFilter);
        const { data: txs } = await txQuery;
        // Список актуальных счетов пользователя — чтобы пометить удалённые
        const { data: accountsNow } = await supabase
            .from("wallet")
            .select("code")
            .eq("user_id", user.id);
        const aliveCodes = new Set((accountsNow || []).map((a) => a.code));
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("Полная выписка");
        ws.columns = [
            { header: "Дата", key: "date", width: 22 },
            { header: "Счёт", key: "code", width: 10 },
            { header: "Сумма", key: "amount", width: 12 },
            { header: "Пользователь", key: "user", width: 18 },
            { header: "Группа", key: "group", width: 24 },
            { header: "Остаток", key: "balance", width: 12 },
        ];
        for (const t of txs || []) {
            const date = new Date(t.created_at);
            const formattedDate = date
                .toLocaleString("ru-RU", {
                timeZone: "Asia/Almaty",
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            })
                .replace(/\./g, "-");
            const codeLabel = aliveCodes.has(t.code) ? t.code : `${t.code} (удалён)`;
            ws.addRow({
                date: formattedDate,
                code: codeLabel,
                amount: t.amount,
                user: (usernameOverride || t.username) ? `@${usernameOverride ?? t.username}` : "",
                group: t.chat_title || "",
                balance: t.balance_after,
            });
        }
        // Стиль чисел
        ws.getColumn("amount").numFmt = "#,##0.00;[Red]-#,##0.00";
        ws.getColumn("balance").numFmt = "#,##0.00";
        const buf = await wb.xlsx.writeBuffer();
        const suffix = codeFilter ? `_${codeFilter}` : "";
        const fileName = `Полная_выписка${suffix}_${new Date()
            .toISOString()
            .slice(0, 10)}.xlsx`;
        // Передаем как Buffer + fileOptions (корректный multipart/form-data)
        const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
        await bot.sendDocument(chatId, buffer, {}, {
            filename: fileName,
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
    }
    catch (e) {
        console.error("sendReportXls error:", e);
        await bot.sendMessage(chatId, "⚠️ Не удалось сформировать отчёт.");
    }
};
