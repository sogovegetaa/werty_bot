import { type Message } from "node-telegram-bot-api";
import { supabase } from "../api.js";
import { bot } from "../index.js";
export const startModule = async (msg: Message): Promise<void> => {
    const userId = msg.from.id;
    const username = msg.from.username;
    const { data: user, error: userError } = await supabase
        .from("user")
        .select("*")
        .eq("telegram_id", userId);
    if (userError) {
        console.error("Error fetching user:", userError);
        return;
    }
    if (user?.length === 0) {
        const { error } = await supabase
            .from("user")
            .insert({ telegram_id: userId, username });
        if (error) {
            console.error("Error creating user:", error);
            return;
        }
    }
    else {
        await bot.sendMessage(msg.chat.id, `С возвращением, ${username || "друг"}! 👋`);
    }
};
