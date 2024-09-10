const { Telegraf, Markup, Scenes, session } = require('telegraf');
const BankVerificationService = require('./services/bankVerificationService');
const UnifiedWalletService = require('./services/unifiedWalletService');
const TransactionValidationService = require('./services/transactionValidationService');
const registerBankAccount = require('./scenes/registerBankAccount');
const sendCryptoScene = require('./scenes/sendCryptoScene');
const checkTransactionScene = require('./scenes/checkTransactionScene');


const generateMainMenu = require('./scenes/messages/generateMainMenu');
const sendBankSelectionMessage = require('./scenes/messages/sendBankSelectionMessage');

const logger = require('./utils/logger');

require('dotenv').config();

const bot = new Telegraf(process.env.easi_BOT_TOKEN);

// Use session to store user data
bot.use(session());



// Function to generate support menu
function generateSupportMenu(ctx) {
    const supportMenuMarkup = Markup.inlineKeyboard([
        [Markup.button.callback('Contact Support', 'contact_support')],
        [Markup.button.callback('FAQ', 'faq')],
        [Markup.button.callback('Back to Main Menu', 'main_menu')]
    ]);
    
    return ctx.reply('How can we assist you?', supportMenuMarkup);
}

// Function to handle callback queries
async function handleCallbackQuery(ctx, next) {
    try {
        await ctx.answerCbQuery();
        return next();
    } catch (error) {
        if (error.description && error.description.includes('query is too old')) {
            logger.warn('Old callback query detected', { userId: ctx.from.id, query: ctx.callbackQuery.data });
            await ctx.reply('This menu has expired. Here\'s a fresh one:');
            await generateMainMenu(ctx);
        } else {
            logger.error('Callback query error', { error: error.message, userId: ctx.from.id });
            await ctx.reply('An error occurred. Please try again.');
            await generateMainMenu(ctx);
        }
    }
}

// Error handler
const errorHandler = async (error, ctx) => {
    logger.error('Bot error', { error: error.message, userId: ctx.from?.id, chatId: ctx.chat?.id });
    await ctx.reply('An unexpected error occurred. Our team has been notified. Here are some options:', 
        Markup.inlineKeyboard([
            [Markup.button.callback('Try Again', 'main_menu')],
            [Markup.button.callback('Get Help', 'support_menu')]
        ])
    );
};

bot.catch(errorHandler);

// Use the handler for all callback queries
bot.on('callback_query', handleCallbackQuery);

// Initialize bank list when the bot starts
bot.use(async (ctx, next) => {
    if (!ctx.session) {
      ctx.session = {};
    }
    if (!ctx.session.banksInitialized) {
      await BankVerificationService.initializeBankList();
      ctx.session.banksInitialized = true;
    }
    return next();
});

bot.command('start', async (ctx) => {
    const description = "Welcome to the easiBlock Bot! This bot depostis Naira in less than 5mins to your account by selling crypto from any Blockchain supported, Doesn't have to be only usdt,btc,eth.\n\nSupported chains: Ethereum, BSC, Solana, Tron";
    await ctx.reply(description);
    await generateMainMenu(ctx);
});


const stage = new Scenes.Stage([sendCryptoScene, checkTransactionScene, registerBankAccount]);
bot.use(stage.middleware());

bot.action('send_crypto', async (ctx) => {
    try {
        if (ctx.session.bankAccount && ctx.session.bankAccount.isVerified) {
            await ctx.scene.enter('SEND_CRYPTO');
        } else {
            await ctx.reply('You need to register and verify your bank account first.');
            await ctx.scene.enter('BANK_REGISTRATION');
        }
    } catch (error) {
        logger.error('Error handling send crypto action', { error: error.message, userId: ctx.from.id });
        await ctx.reply('An error occurred. Please try again.');
        await generateMainMenu(ctx);
    }
});
bot.action('tx_status', async (ctx) => {
    try {
        await ctx.scene.enter('CHECK_TRANSACTION');
    } catch (error) {
        logger.error('Error entering check transaction scene', { error: error.message, userId: ctx.from.id });
        await ctx.reply('An error occurred. Please try again.');
        await generateMainMenu(ctx);
    }
});

bot.action('register_bank', async (ctx) => {
    try {
        await ctx.scene.enter('BANK_REGISTRATION');
    } catch (error) {
        logger.error('Error entering check registration scene', { error: error.message, userId: ctx.from.id });
        await ctx.reply('An error occurred. Please try again.');
        await generateMainMenu(ctx);
    }
});

bot.action('help', async (ctx) => {
    try {
        await generateSupportMenu(ctx);
    } catch (error) {
        logger.error('Error in help action', { error: error.message, userId: ctx.from.id });
        await ctx.reply('An error occurred. Please try again.');
        await generateMainMenu(ctx);
    }
});

// Handle text inputs for transaction status checks
bot.on('text', async (ctx) => {
    const extractedData = TransactionValidationService.extractTransactionHash(ctx.message.text);
    
    if (extractedData) {
        const { hash, chain } = extractedData;
        try {
            const validationResult = await TransactionValidationService.validateTransaction(hash, chain);

            let transactionDetails = ctx.session.transactions && ctx.session.transactions[hash];

            if (validationResult.isValid) {
                let message = `Transaction Status:\n\n` +
                              `Hash: ${hash}\n` +
                              `Chain: ${chain}\n` +
                              `Status: ${validationResult.status}\n`;
                
                // if (validationResult.confirmations !== undefined) {
                //     message += `Confirmations: ${validationResult.confirmations}\n`;
                // }

                if (transactionDetails) {
                    message += `\nAccount Name: ${transactionDetails.accountName}\n` +
                               `Account Number: ${transactionDetails.accountNumber}\n`;
                    
                    // Update stored transaction status
                    transactionDetails.status = validationResult.status;
                }
                
                await ctx.reply(message);
            } else {
                await ctx.reply(`Transaction check failed: ${validationResult.error}`);
            }
        } catch (error) {
            logger.error('Transaction validation error', { error: error.message, hash: hash, chain: chain });
            await ctx.reply('Error validating transaction. Please try again or contact support.');
        }
    } else {
        await ctx.reply('Sorry, I did not understand that. Please use the menu options or enter a valid transaction hash or URL.');
    }
    await generateMainMenu(ctx);
});

// Action handlers for menus
bot.action('main_menu', async (ctx) => {
    try {
        await generateMainMenu(ctx);
    } catch (error) {
        logger.error('Error generating main menu', { error: error.message, userId: ctx.from.id });
        await ctx.reply('An error occurred. Please try again.');
    }
});

bot.action('support_menu', async (ctx) => {
    try {
        await generateSupportMenu(ctx);
    } catch (error) {
        logger.error('Error generating support menu', { error: error.message, userId: ctx.from.id });
        await ctx.reply('An error occurred. Please try again.');
        await generateMainMenu(ctx);
    }
});

bot.action('contact_support', async (ctx) => {
    try {
        await ctx.reply('Please contact our support team at @easiBlockSupport or email support@easiblock.com');
        await generateSupportMenu(ctx);
    } catch (error) {
        logger.error('Error in contact_support action', { error: error.message, userId: ctx.from.id });
        await ctx.reply('An error occurred. Please try again.');
        await generateMainMenu(ctx);
    }
});

bot.action('faq', async (ctx) => {
    try {
        await ctx.reply('Here are some frequently asked questions:\n\n1. How long does a transaction take?\n2. What cryptocurrencies do you support?\n3. How do I track my transaction?\n\nFor more questions, please visit our website or contact support.');
        await generateSupportMenu(ctx);
    } catch (error) {
        logger.error('Error in faq action', { error: error.message, userId: ctx.from.id });
        await ctx.reply('An error occurred. Please try again.');
        await generateMainMenu(ctx);
    }
});

// New action handler for the copy address button
bot.action(/^copy_(.+)$/, async (ctx) => {
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

bot.launch().catch(error => {
    logger.error('Bot launch failed', { error: error.message });
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));