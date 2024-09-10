const { Markup } = require('telegraf');

function generateMainMenu(ctx) {
    const mainMenuMarkup = Markup.inlineKeyboard([
        [Markup.button.callback('Register Bank Account', 'register_bank')],
        [Markup.button.callback('easiConvert Crypto', 'send_crypto'), Markup.button.callback('Check Status', 'tx_status')],
        [Markup.button.callback('Help', 'help')]
    ]);
    
    return ctx.reply('What would you like to do?', mainMenuMarkup);
}

module.exports = generateMainMenu;