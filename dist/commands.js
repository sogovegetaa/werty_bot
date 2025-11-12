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
export const commandHandlers = {
    [BotCommands.START]: startModule, // команда /start
    [BotCommands.PR]: createOrderModule, // команда /пр
    [BotCommands.GIVE]: balanceShowModule, // команда /дай
    [BotCommands.SEND]: orderSendModule, // команда /отпр
    [BotCommands.CHANGE]: updateOrderModule, // команда /изм  
    [BotCommands.CALC]: calcModule, // команда /калк
    [BotCommands.ADD_ACCOUNT]: walletAddModule, // команда /добавь
    [BotCommands.DELETE_ACCOUNT]: walletRemoveModule, // команда /удали
    [BotCommands.RATE]: rateModule, // команда /курс
    [BotCommands.KURSI_RATE]: kursiRateModule, // команда /ккурс
    [BotCommands.ORDERS]: ordersListModule, // команда /заявки
    [BotCommands.HELP]: async (m) => {
        await bot.sendMessage(m.chat.id, helpDoc, { parse_mode: "HTML", disable_web_page_preview: true }); // команда /help
    },
};
