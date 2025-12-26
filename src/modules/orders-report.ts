import { type Message } from "node-telegram-bot-api";
import { bot } from "../index.js";
import { supabase } from "../api.js";
type Scope = "mine" | "all";
type OverrideUser = {
    telegramId: number;
    username?: string;
};
export const sendOrdersReportXls = async (msg: Message, scope: Scope, overrideUser?: OverrideUser): Promise<void> => {
    const chatId = msg.chat.id;
    try {
        const ExcelJS = (await import("exceljs")).default as any;
        const telegramId = overrideUser?.telegramId ?? msg.from!.id;
        const { data: currentUser, error: userErr } = await supabase
            .from("user")
            .select("id, username, role")
            .eq("telegram_id", telegramId)
            .single();
        if (userErr || !currentUser) {
            await bot.sendMessage(chatId, "❌ Сначала зарегистрируйся через /start.");
            return;
        }
        if (scope === "all" && currentUser.role !== "admin") {
            await bot.sendMessage(chatId, "⛔ Выгрузка всех заявок доступна только администраторам.");
            return;
        }
        let query = supabase
            .from("order")
            .select("id, rub_get, rub_give, rate, usdt_amount, sent_usdt, remaining_usdt, status, created_at, updated_at, user_id")
            .eq("chat_id", chatId)
            .order("created_at", { ascending: true });
        if (scope === "mine") {
            query = query.eq("user_id", currentUser.id);
        }
        const { data: orders, error } = await query;
        if (error)
            throw error;
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet(scope === "all" ? "Все заявки" : "Мои заявки");
        ws.columns = [
            { header: "ID", key: "id", width: 8 },
            { header: "Дата", key: "date", width: 20 },
            { header: "Статус", key: "status", width: 12 },
            { header: "Получаем RUB", key: "rub_get", width: 16 },
            { header: "Отдаём USDT", key: "usdt_amount", width: 16 },
            { header: "Курс", key: "rate", width: 10 },
            { header: "Отправлено USDT", key: "sent_usdt", width: 16 },
            { header: "Остаток USDT", key: "remaining_usdt", width: 16 },
            { header: "Обновлено", key: "updated", width: 20 },
        ];
        for (const o of orders || []) {
            const created = new Date(o.created_at).toLocaleString("ru-RU", {
                timeZone: "Asia/Almaty",
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            });
            const updated = o.updated_at
                ? new Date(o.updated_at).toLocaleString("ru-RU", {
                    timeZone: "Asia/Almaty",
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                })
                : "";
            ws.addRow({
                id: o.id,
                date: created,
                status: o.status,
                rub_get: o.rub_get ?? 0,
                usdt_amount: o.usdt_amount ?? 0,
                rate: o.rate ?? 0,
                sent_usdt: o.sent_usdt ?? 0,
                remaining_usdt: o.remaining_usdt ?? 0,
                updated,
            });
        }
        ws.getColumn("rub_get").numFmt = "#,##0";
        ws.getColumn("usdt_amount").numFmt = "#,##0.00";
        ws.getColumn("sent_usdt").numFmt = "#,##0.00";
        ws.getColumn("remaining_usdt").numFmt = "#,##0.00";
        ws.getColumn("rate").numFmt = "0.00";
        const buf = await wb.xlsx.writeBuffer();
        const fileName = `Заявки_${scope === "all" ? "все" : "мои"}_${new Date()
            .toISOString()
            .slice(0, 10)}.xlsx`;
        const buffer = Buffer.isBuffer(buf) ? (buf as Buffer) : Buffer.from(buf as ArrayBuffer);
        await bot.sendDocument(chatId, buffer as any, {}, {
            filename: fileName,
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        } as any);
    }
    catch (e) {
        console.error("sendOrdersReportXls error:", e);
        await bot.sendMessage(chatId, "⚠️ Не удалось сформировать отчёт по заявкам.");
    }
};
