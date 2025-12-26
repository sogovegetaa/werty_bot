import { Message } from "node-telegram-bot-api";
import { helpDoc } from "./utils/messages.js";
import { startModule } from "./modules/start.js";
import { BotCommands } from "./enums.js";
import { createOrderModule } from "./modules/order-create.js";
import { balanceShowModule } from "./modules/balance-show.js";
import { orderSendModule } from "./modules/order-send.js";
import { updateOrderModule } from "./modules/order-update.js";
import { calcModule } from "./modules/calc.js";
import { bot } from "./index.js";
import { walletAddModule } from "./modules/wallet-add.js";
import { walletRemoveModule } from "./modules/wallet-remove.js";
import { rateModule } from "./modules/rate.js";
import { ordersListModule } from "./modules/orders-list.js";
import { kursiRateModule } from "./modules/kursi.js";
export const commandHandlers: Record<string, (msg: Message) => void | Promise<void>> = {
    [BotCommands.START]: startModule,
    [BotCommands.PR]: createOrderModule,
    [BotCommands.GIVE]: balanceShowModule,
    [BotCommands.SEND]: orderSendModule,
    [BotCommands.CHANGE]: updateOrderModule,
    [BotCommands.CALC]: calcModule,
    [BotCommands.ADD_ACCOUNT]: walletAddModule,
    [BotCommands.DELETE_ACCOUNT]: walletRemoveModule,
    [BotCommands.RATE]: rateModule,
    [BotCommands.KURSI_RATE]: kursiRateModule,
    [BotCommands.ORDERS]: ordersListModule,
    [BotCommands.HELP]: async (m: Message) => {
        await bot.sendMessage(m.chat.id, helpDoc, { parse_mode: "HTML", disable_web_page_preview: true });
    },
};
