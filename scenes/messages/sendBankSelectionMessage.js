const { Markup } = require('telegraf');
const BankVerificationService = require('../../services/bankVerificationService');

async function sendBankSelectionMessage(ctx) {
    const pageSize = 8;
    const totalPages = BankVerificationService.getTotalPages(pageSize);
    const currentPage = ctx.session.bankPage || 1;

    const banks = BankVerificationService.getBankListPage(currentPage, pageSize);

    const bankButtons = banks.map(bank => 
        [Markup.button.callback(bank.name, `bank_${bank.code}`)]
    );

    const navigationButtons = [];
    if (currentPage > 1) {
        navigationButtons.push(Markup.button.callback('◀️ Previous', 'prev_page'));
    }
    if (currentPage < totalPages) {
        navigationButtons.push(Markup.button.callback('Next ▶️', 'next_page'));
    }

    const keyboard = [
        ...bankButtons,
        navigationButtons
    ];

    await ctx.reply(`Select your bank (Page ${currentPage}/${totalPages}):`, 
        Markup.inlineKeyboard(keyboard)
    );
}

module.exports = sendBankSelectionMessage;