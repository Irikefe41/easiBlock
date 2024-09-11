const { Scenes, Markup } = require('telegraf');
const TransactionValidationService = require('../services/transactionValidationService');
const UnifiedWalletService = require('../services/unifiedWalletService');
const logger = require('../utils/logger');
const generateMainMenu = require('./messages/generateMainMenu');

const MAX_RETRIES = 3;

const checkTransactionScene = new Scenes.WizardScene(
    'CHECK_TRANSACTION',
    async (ctx) => {
        ctx.scene.state.retries = 0;
        await ctx.reply(
            'Please enter the transaction hash or the full transaction URL.\n' +
            'Or type /cancel to exit this operation.',
            Markup.keyboard(['/cancel']).oneTime().resize()
        );
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message && ctx.message.text === '/cancel') {
            await ctx.reply('Operation cancelled.', Markup.removeKeyboard());
            await generateMainMenu(ctx);
            return ctx.scene.leave();
        }

        if (!ctx.message || !ctx.message.text) {
            ctx.scene.state.retries++;
            if (ctx.scene.state.retries >= MAX_RETRIES) {
                await ctx.reply('Too many invalid attempts. Exiting...', Markup.removeKeyboard());
                await generateMainMenu(ctx);
                return ctx.scene.leave();
            }
            await ctx.reply(
                `Please enter a valid transaction hash or URL. Retry ${ctx.scene.state.retries}/${MAX_RETRIES}.\n` +
                'Or type /cancel to exit.'
            );
            return;
        }

        try {
            const extractedData = TransactionValidationService.extractTransactionHash(ctx.message.text);
            
            if (!extractedData) {
                ctx.scene.state.retries++;
                if (ctx.scene.state.retries >= MAX_RETRIES) {
                    await ctx.reply('Too many invalid attempts. Exiting...', Markup.removeKeyboard());
                    await generateMainMenu(ctx);
                    return ctx.scene.leave();
                }
                await ctx.reply(
                    `Unable to extract a valid transaction hash. Here's some guidance:\n\n` +
                    TransactionValidationService.getTransactionHashGuidance() +
                    `\n\nPlease try again. Retry ${ctx.scene.state.retries}/${MAX_RETRIES}.\n` +
                    'Or type /cancel to exit.'
                );
                return;
            }
            
            const { hash, chain } = extractedData;
            
            // Get the expected deposit address
            const expectedAddress = await UnifiedWalletService.getDepositAddress(ctx.from.id, chain);

            // Perform detailed transaction validation
            const validationResult = await TransactionValidationService.validateTransaction(hash, chain, expectedAddress.address);
            
            if (validationResult.isValid) {
                let message = `Transaction Status:\n\n` +
                              `Hash: ${hash}\n` +
                              `Chain: ${chain}\n` +
                              `Type: ${validationResult.type === 'native' ? 'Native token' : 'Token'} transfer\n` +
                              `Amount: ${validationResult.amount} ${validationResult.type === 'native' ? chain.toUpperCase() : 'tokens'}\n` +
                              `Status: ${validationResult.status}\n` +
                              `From: ${validationResult.from}\n` +
                              `To: ${validationResult.to}\n`;
                
                if (validationResult.type === 'token') {
                    message += `Token Address: ${validationResult.tokenAddress}\n`;
                }
                
                // If we have stored transaction details, include them
                const storedTransaction = ctx.session.transactions && ctx.session.transactions[hash];
                if (storedTransaction) {
                    message += `\nStored Transaction Details:\n` +
                               `Account Name: ${ctx.session.bankAccount?.accountName || 'Not available'}\n` +
                               `Account Number: ${ctx.session.bankAccount?.accountNumber || 'Not available'}\n`;
                }
                
                await ctx.reply(message, Markup.removeKeyboard());
            } else {
                await ctx.reply(`Transaction check failed: ${validationResult.error}`, Markup.removeKeyboard());
            }
        } catch (error) {
            logger.error('Error validating transaction:', error);
            await ctx.reply('An error occurred while validating the transaction. Please try again later or contact support.', Markup.removeKeyboard());
        }
        
        await generateMainMenu(ctx);
        return ctx.scene.leave();
    }
);

// Handler for /cancel command
checkTransactionScene.command('cancel', async (ctx) => {
    await ctx.reply('Operation cancelled.', Markup.removeKeyboard());
    await generateMainMenu(ctx);
    return ctx.scene.leave();
});

module.exports = checkTransactionScene;