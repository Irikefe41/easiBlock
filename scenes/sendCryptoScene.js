const { Scenes, Markup } = require('telegraf');
const BankVerificationService = require('../services/bankVerificationService');
const UnifiedWalletService = require('../services/unifiedWalletService');
const TransactionValidationService = require('../services/transactionValidationService');
const logger = require('../utils/logger');
const generateMainMenu = require('./messages/generateMainMenu');

const MAX_RETRIES = 3;

const sendCryptoScene = new Scenes.WizardScene(
    'SEND_CRYPTO',
    // Step 1: Check bank verification and select blockchain
    async (ctx) => {
        // Check if bank account is verified
        if (!ctx.session.bankAccount || !ctx.session.bankAccount.isVerified) {
            await ctx.reply('You need to register and verify your bank account first.');
            await ctx.scene.enter('BANK_REGISTRATION');
            return ctx.scene.leave();
        }

        await ctx.reply('Choose a blockchain to send from:', 
            Markup.inlineKeyboard([
                [Markup.button.callback('Ethereum', 'chain_ethereum'),
                 Markup.button.callback('BSC', 'chain_bsc')],
                [Markup.button.callback('Solana', 'chain_solana'),
                 Markup.button.callback('Tron', 'chain_tron')]
            ])
        );
        return ctx.wizard.next();
    },
    // Step 2: Handle blockchain selection
    async (ctx) => {
        if (!ctx.callbackQuery) {
            await ctx.reply('Please select a blockchain from the options provided.');
            return;
        }
        const chain = ctx.callbackQuery.data.split('_')[1];
        ctx.session.chain = chain;
        
        // Get deposit address
        try {
            const { address, memo } = await UnifiedWalletService.getDepositAddress(ctx.from.id, chain);
            ctx.session.depositAddress = address;
            ctx.session.depositMemo = memo;

            const copyAddressMarkup = Markup.inlineKeyboard([
                Markup.button.callback('📋 Copy Address', `copy_${address}`)
            ]);

            await ctx.replyWithMarkdown(
                `Great! Please send your ${chain.toUpperCase()} tokens to this address:\n` +
                `\`${address}\`\n\n` +
                `Memo (important):\n\`${memo}\`\n\n` +
                `*⚠️ IMPORTANT: After sending, please enter the transaction hash.*\n` +
                'Or type /cancel to exit.',
                copyAddressMarkup
            );
            return ctx.wizard.next();
        } catch (error) {
            logger.error('Error getting deposit address', { error: error.message, userId: ctx.from.id, chain });
            await ctx.reply('An error occurred while generating the deposit address. Please try again.');
            return ctx.scene.leave();
        }
    },
    // Step 3: Handle transaction hash input and validation
    async (ctx) => {
        if (!ctx.scene.state.retries) {
            ctx.scene.state.retries = 0;
        }

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
                `Please enter a valid transaction hash. Retry ${ctx.scene.state.retries}/${MAX_RETRIES}.\n` +
                'Or type /cancel to exit.',
                Markup.keyboard(['/cancel']).oneTime().resize()
            );
            return;
        }
        
        const txHash = ctx.message.text.trim();
        const extractedData = TransactionValidationService.extractTransactionHash(txHash);

        if (!extractedData) {
            ctx.scene.state.retries++;
            if (ctx.scene.state.retries >= MAX_RETRIES) {
                await ctx.reply('Too many invalid attempts. Exiting...', Markup.removeKeyboard());
                await generateMainMenu(ctx);
                return ctx.scene.leave();
            }
            await ctx.reply(
                'Unable to extract a valid transaction hash. Here\'s some guidance on transaction hashes:\n\n' +
                TransactionValidationService.getTransactionHashGuidance() +
                `\n\nPlease try again. Retry ${ctx.scene.state.retries}/${MAX_RETRIES}.\n` +
                'Or type /cancel to exit.',
                Markup.keyboard(['/cancel']).oneTime().resize()
            );
            return;
        }

        const { hash, chain } = extractedData;

        if (chain !== ctx.session.chain) {
            ctx.scene.state.retries++;
            if (ctx.scene.state.retries >= MAX_RETRIES) {
                await ctx.reply('Too many invalid attempts. Exiting...', Markup.removeKeyboard());
                await generateMainMenu(ctx);
                return ctx.scene.leave();
            }
            await ctx.reply(
                `The provided transaction hash is for ${chain}, but you selected ${ctx.session.chain}. ` +
                `Please provide a transaction hash for ${ctx.session.chain}.\n\n` +
                `Retry ${ctx.scene.state.retries}/${MAX_RETRIES}.\n` +
                'Or type /cancel to exit.',
                Markup.keyboard(['/cancel']).oneTime().resize()
            );
            return;
        }

        try {
            const validationResult = await TransactionValidationService.validateTransaction(hash, chain, ctx.session.depositAddress);

            if (!validationResult.isValid) {
                ctx.scene.state.retries++;
                if (ctx.scene.state.retries >= MAX_RETRIES) {
                    await ctx.reply('Too many invalid attempts. Exiting...', Markup.removeKeyboard());
                    await generateMainMenu(ctx);
                    return ctx.scene.leave();
                }
                await ctx.reply(
                    `Transaction validation failed: ${validationResult.error}\n\n` +
                    `Please try again with a valid transaction hash. Retry ${ctx.scene.state.retries}/${MAX_RETRIES}.\n` +
                    'Or type /cancel to exit.',
                    Markup.keyboard(['/cancel']).oneTime().resize()
                );
                return;
            }

            // Transaction is valid, proceed with storing details and finishing the process
            if (!ctx.session.transactions) {
                ctx.session.transactions = {};
            }

            ctx.session.transactions[hash] = {
                chain: validationResult.chain,
                type: validationResult.type,
                amount: validationResult.amount,
                status: validationResult.status,
                from: validationResult.from,
                to: validationResult.to,
                tokenAddress: validationResult.tokenAddress,
                timestamp: Date.now()
            };

            let responseMessage = `Thank you, ${ctx.session.bankAccount.accountName}. We have received your transaction:\n\n`;
            responseMessage += `Type: ${validationResult.type === 'native' ? 'Native token' : 'Token'} transfer\n`;
            responseMessage += `Amount: ${validationResult.amount} ${validationResult.type === 'native' ? validationResult.chain.toUpperCase() : 'tokens'}\n`;
            responseMessage += `Status: ${validationResult.status}\n`;
            responseMessage += `From: ${validationResult.from}\n`;
            responseMessage += `To: ${validationResult.to}\n`;

            if (validationResult.type === 'token') {
                responseMessage += `Token Address: ${validationResult.tokenAddress}\n`;
            }

            responseMessage += `\nCurrent status: ${validationResult.status}. You will receive a confirmation in your bank account (${ctx.session.bankAccount.accountNumber}) once the transaction is fully processed.`;

            await ctx.reply(responseMessage, Markup.removeKeyboard());

            logger.info('Transaction details stored', { 
                userId: ctx.from.id, 
                hash: hash, 
                ...ctx.session.transactions[hash]
            });

            await ctx.reply('Thank you for using our service. Is there anything else you would like to do?');
            await generateMainMenu(ctx);
            return ctx.scene.leave();
        } catch (error) {
            logger.error('Error in transaction validation', {
                userId: ctx.from.id,
                error: error.message,
                stack: error.stack
            });
            await ctx.reply('An unexpected error occurred while processing your transaction. Our team has been notified. Please try again later or contact support.', Markup.removeKeyboard());
            await generateMainMenu(ctx);
            return ctx.scene.leave();
        }
    }
);

// Add this command handler to the scene
sendCryptoScene.command('cancel', async (ctx) => {
    await ctx.reply('Operation cancelled.', Markup.removeKeyboard());
    await generateMainMenu(ctx);
    return ctx.scene.leave();
});

// Handler for the copy address button
sendCryptoScene.action(/^copy_(.+)$/, async (ctx) => {
    const address = ctx.match[1];
    try {
        await ctx.answerCbQuery('Address copied to clipboard!');
        // Note: The actual copying is done on the client side. 
        // This just provides feedback to the user.
    } catch (error) {
        logger.error('Error in copy address action', { error: error.message, userId: ctx.from.id });
        await ctx.answerCbQuery('Error copying address. Please try again.');
    }
});

module.exports = sendCryptoScene;