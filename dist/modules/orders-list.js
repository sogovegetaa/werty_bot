import { bot } from "../index.js";
import { supabase } from "../api.js";
function formatDate(d) {
    const date = typeof d === "string" ? new Date(d) : d;
    return date.toLocaleString("ru-RU", {
        timeZone: "Asia/Almaty",
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}
export const ordersListModule = async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim() || "";
    // Поддерживаем фильтры: "/заявки", "/заявки мои", "/заявки все"
    const arg = text.split(/\s+/)[1]?.toLowerCase();
    try {
        const { data: currentUser } = await supabase
            .from("user")
            .select("id, role")
            .eq("telegram_id", msg.from.id)
            .single();
        if (!currentUser) {
            await bot.sendMessage(chatId, "❌ Сначала зарегистрируйся через /start.");
            return;
        }
        let query = supabase
            .from("order")
            .select("id, rub_get, usdt_amount, sent_usdt, remaining_usdt, rate, status, created_at, user_id")
            .eq("chat_id", chatId)
            .order("created_at", { ascending: false })
            .limit(20);
        if (arg === "все") {
            if (currentUser.role !== "admin") {
                await bot.sendMessage(chatId, "⛔ Команда доступна только администраторам.");
                return;
            }
            // все заявки любых статусов в этом чате (ограничим 20)
        }
        else {
            // по умолчанию: только заявки текущего пользователя в этом чате и только открытые
            query = query
                .eq("user_id", currentUser.id)
                .in("status", ["created", "partial"]);
        }
        const { data: orders, error } = await query;
        if (error)
            throw error;
        if (!orders || orders.length === 0) {
            const emptyText = arg === "все" ? "Заявки не найдены." : "Открытых заявок не найдено.";
            await bot.sendMessage(chatId, emptyText);
            return;
        }
        const lines = orders.map((o) => {
            const getStr = Number(o.rub_get || 0).toLocaleString("ru-RU");
            const remaining = o.remaining_usdt != null
                ? Number(o.remaining_usdt)
                : Math.max(Number(o.usdt_amount || 0) - Number(o.sent_usdt || 0), 0);
            const usdtStr = Number(remaining).toLocaleString("ru-RU");
            const rateStr = Number(o.rate || 0).toString();
            const when = formatDate(o.created_at);
            return `#${o.id} — Получаем: <code>${getStr}</code> руб | Отдаем: <code>${usdtStr}</code> юсдт | Курс: <code>${rateStr}</code> | Статус: <b>${o.status}</b> | От: <code>${when}</code>`;
        });
        const title = arg === "все" ? "Все заявки (последние)" : "Мои открытые заявки";
        const message = `${title} (${orders.length}):\n\n${lines.join("\n")}\n\nПодсказка: \n/заявки — ваши открытые, /заявки все — все статусы (только admin)`;
        const scope = arg === "все" ? "all" : "mine";
        const callback = `orders_xls:${scope}`;
        await bot.sendMessage(chatId, message, {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [[{ text: "Скачать XLS", callback_data: callback }]],
            },
        });
    }
    catch (e) {
        console.error("/заявки error:", e);
        await bot.sendMessage(chatId, "⚠️ Ошибка при получении заявок.");
    }
};
