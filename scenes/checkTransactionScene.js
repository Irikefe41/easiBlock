const { Scenes } = require('telegraf');
const TransactionValidationService = require('../services/transactionValidationService');
const UnifiedWalletService = require('../services/unifiedWalletService');
const logger = require('../utils/logger');
const generateMainMenu = require('./messages/generateMainMenu');

const checkTransactionScene = new Scenes.WizardScene(
    'CHECK_TRANSACTION',
    async (ctx) => {
        await ctx.reply('Please enter the transaction hash or the full transaction URL:');
        return ctx.wizard.next();
    },
    async (ctx) => {
        try {
            if (!ctx.message || !ctx.message.text) {
                await ctx.reply('Please enter a valid transaction hash or URL.');
                return;
            }
            
            const extractedData = TransactionValidationService.extractTransactionHash(ctx.message.text);
            
            if (!extractedData) {
                await ctx.reply('Unable to extract a valid transaction hash. Here\'s some guidance on transaction hashes:');
                await ctx.reply(TransactionValidationService.getTransactionHashGuidance());
                await ctx.reply('Please try again with a valid transaction hash or URL.');
                return;
            }
            
            const { hash, chain } = extractedData;
            
            // Get the expected deposit address
            const expectedAddress = await UnifiedWalletService.getDepositAddress(ctx.from.id, ctx.session.chain);

            // Perform detailed transaction validation
            const validationResult = await TransactionValidationService.validateTransaction(hash, ctx.session.chain, expectedAddress.address);
            
            if (validationResult.isValid) {
                let message = `Transaction Status:\n\n` +
                              `Hash: ${hash}\n` +
                              `Chain: ${ctx.session.chain}\n` +
                              `Type: ${validationResult.type === 'native' ? 'Native token' : 'Token'} transfer\n` +
                              `Amount: ${validationResult.amount} ${validationResult.type === 'native' ? ctx.session.chain.toUpperCase() : 'tokens'}\n` +
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
                
                await ctx.reply(message);
            } else {
                await ctx.reply(`Transaction check failed: ${validationResult.error}`);
            }
        } catch (error) {
            logger.error('Error validating transaction:', error);
            await ctx.reply('An error occurred while validating the transaction. Please try again later or contact support.');
        }
        
        await generateMainMenu(ctx);
        return ctx.scene.leave();
    }
);

module.exports = checkTransactionScene;