const { Scenes, Markup } = require('telegraf');
const BankVerificationService = require('../services/bankVerificationService');
const generateMainMenu = require('./messages/generateMainMenu');
const sendBankSelectionMessage = require('./messages/sendBankSelectionMessage');
const logger = require('../utils/logger');

const registerBankAccount = new Scenes.WizardScene(
    'BANK_REGISTRATION',
    async (ctx) => {
        // Step 1: Initialize the bank list and show the first page
        ctx.session.bankPage = 1;
        await sendBankSelectionMessage(ctx);
        return ctx.wizard.next();
    },
    async (ctx) => {
        // Step 2: Handle bank selection or pagination
        if (ctx.callbackQuery) {
            const action = ctx.callbackQuery.data;
            if (action === 'next_page' || action === 'prev_page') {
                ctx.session.bankPage = action === 'next_page' ? ctx.session.bankPage + 1 : ctx.session.bankPage - 1;
                await sendBankSelectionMessage(ctx);
                return;
            } else if (action.startsWith('bank_')) {
                ctx.session.selectedBankCode = action.split('_')[1];
                await ctx.reply('Please enter your account number:');
                return ctx.wizard.next();
            }
        } else {
            await ctx.reply('Please select a bank from the list.');
        }
    },
    async (ctx) => {
        // Step 3: Handle account number input and verification
        if (ctx.message && ctx.message.text) {
            const accountNumber = ctx.message.text.trim();
            if (!/^\d+$/.test(accountNumber)) {
                await ctx.reply('Please enter a valid account number (digits only).');
                return;
            }

            try {
                const verifiedAccount = await BankVerificationService.verifyAccount(accountNumber, ctx.session.selectedBankCode);
                ctx.session.verifiedName = verifiedAccount.accountName;
                ctx.session.accountNumber = accountNumber;
                await ctx.reply(`Account verified. Welcome, ${verifiedAccount.accountName}!\n\nIs this correct?`,
                    Markup.inlineKeyboard([
                        [Markup.button.callback('Yes, save this account', 'save_account')],
                        [Markup.button.callback('No, start over', 'restart_registration')]
                    ])
                );
                return ctx.wizard.next();
            } catch (error) {
                logger.error('Bank verification error', { error: error.message, userId: ctx.from.id });
                if (error.message === 'Invalid account details') {
                    await ctx.reply('The account details you provided are invalid. Please check and try again.');
                } else {
                    await ctx.reply('We\'re having trouble verifying your account. Please try again later or contact support.');
                }
                ctx.session.bankPage = 1;
                await sendBankSelectionMessage(ctx);
                return ctx.wizard.back();
            }
        } else {
            await ctx.reply('Please enter a valid account number.');
        }
    },
    async (ctx) => {
        // Final step: Confirm and save or restart
        if (ctx.callbackQuery) {
            if (ctx.callbackQuery.data === 'save_account') {
                // Save the account details to the user's session
                ctx.session.bankAccount = {
                    bankCode: ctx.session.selectedBankCode,
                    accountNumber: ctx.session.accountNumber,
                    accountName: ctx.session.verifiedName,
                    isVerified: true
                };
                await ctx.reply(`Great! Your bank account has been saved and verified:\n\nAccount Name: ${ctx.session.verifiedName}\nAccount Number: ${ctx.session.accountNumber}`);
                await ctx.scene.leave();
                // Ask if the user wants to proceed with sending crypto
                await ctx.reply('Do you want to proceed with sending crypto(min: $10 worth)?',
                    Markup.inlineKeyboard([
                        [Markup.button.callback('Yes, send crypto', 'send_crypto')],
                        [Markup.button.callback('No, back to main menu', 'main_menu')]
                    ])
                );
            } else if (ctx.callbackQuery.data === 'restart_registration') {
                await ctx.reply('Let\'s start over. Please select your bank:');
                ctx.session.bankPage = 1;
                await sendBankSelectionMessage(ctx);
                return ctx.wizard.selectStep(1);
            }
        }
    }
);

module.exports = registerBankAccount;