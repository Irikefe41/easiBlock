const { Telegraf, Markup, Scenes, session } = require('telegraf');
const BankVerificationService = require('./bankVerificationService');
const UnifiedWalletService = require('./unifiedWalletService');
const TransactionValidationService = require('./transactionValidationService');
const logger = require('./logger');

require('dotenv').config();

const bot = new Telegraf(process.env.easi_BOT_TOKEN);

// Use session to store user data
bot.use(session());

// Function to generate main menu
function generateMainMenu(ctx) {
    const mainMenuMarkup = Markup.inlineKeyboard([
        [Markup.button.callback('Send Crypto', 'send_crypto')],
        [Markup.button.callback('Transaction Status', 'tx_status')],
        [Markup.button.callback('Help', 'help')]
    ]);
    
    return ctx.reply('What would you like to do?', mainMenuMarkup);
}

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
    const description = "Welcome to the easiBlock Bot! This bot allows you to send cryptocurrencies from multiple blockchains and instantly receive Fiat in your Bank Account.\n\nSupported chains: Ethereum, BSC, Solana, Tron";
    await ctx.reply(description);
    await generateMainMenu(ctx);
});

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

// Scene for sending crypto with early bank verification
const sendCryptoScene = new Scenes.WizardScene(
    'SEND_CRYPTO',
    async (ctx) => {
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
    async (ctx) => {
        if (!ctx.callbackQuery) {
            await ctx.reply('Please select a blockchain from the options provided.');
            return;
        }
        const chain = ctx.callbackQuery.data.split('_')[1];
        ctx.session.chain = chain;
        ctx.session.bankPage = 1;
        await sendBankSelectionMessage(ctx);
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.callbackQuery) {
            await ctx.reply('Please select a bank from the list.');
            return;
        }

        const action = ctx.callbackQuery.data;

        if (action === 'next_page') {
            ctx.session.bankPage++;
            await sendBankSelectionMessage(ctx);
            return;
        } else if (action === 'prev_page') {
            ctx.session.bankPage--;
            await sendBankSelectionMessage(ctx);
            return;
        } else {
            // Bank selected
            const selectedBankCode = action.split('_')[1];
            ctx.session.selectedBankCode = selectedBankCode;
            await ctx.reply('Please enter your account number:');
            return ctx.wizard.next();
        }
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) {
            await ctx.reply('Please enter a valid account number.');
            return;
        }

        const accountNumber = ctx.message.text;

        try {
            const verifiedAccount = await BankVerificationService.verifyAccount(accountNumber, ctx.session.selectedBankCode);
            ctx.session.verifiedName = verifiedAccount.accountName;
            ctx.session.accountNumber = accountNumber;
            await ctx.reply(`Account verified. Welcome, ${verifiedAccount.accountName}!\n\nIs this correct?`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('Yes, proceed', 'bank_verified')],
                    [Markup.button.callback('No, cancel', 'bank_cancel')]
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
            return;
        }
    },
    async (ctx) => {
        if (!ctx.callbackQuery) {
            await ctx.reply('Please select an option to proceed or cancel.');
            return;
        }
        if (ctx.callbackQuery.data === 'bank_cancel') {
            await ctx.reply('Transaction cancelled. Feel free to start over when you are ready.');
            await generateMainMenu(ctx);
            return ctx.scene.leave();
        }
        // Proceed with crypto sending instructions
        const { address, memo } = await UnifiedWalletService.getDepositAddress(ctx.from.id, ctx.session.chain);
        
        // Create an inline keyboard for copying the address
        const copyAddressMarkup = Markup.inlineKeyboard([
            Markup.button.callback('📋 Proceed', `copy_${address}`)
        ]);

        await ctx.replyWithMarkdown(
            `Great! Please send your ${ctx.session.chain} Token to this address:\n` +
            `\`${address}\`\n\n` +
            `Memo (important):\n\`${memo}\`\n\n` +
            `*⚠️ IMPORTANT: After sending, please enter the transaction hash:*`,
            copyAddressMarkup
        );
        return ctx.wizard.next();
    },
    async (ctx) => {
        try {
            if (!ctx.message || !ctx.message.text) {
                await ctx.reply('Please enter a valid transaction hash.');
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

            // Validate that the extracted chain matches the session chain
            if (chain !== ctx.session.chain) {
                await ctx.reply(`The provided transaction hash is for ${chain}, but you selected ${ctx.session.chain}. Please provide a transaction hash for ${ctx.session.chain}.`);
                return;
            }

            // Get the expected deposit address
            const expectedAddress = await UnifiedWalletService.getDepositAddress(ctx.from.id, chain);

            // Perform detailed transaction validation
            const validationResult = await TransactionValidationService.validateTransaction(hash, chain, expectedAddress.address);

            if (!validationResult.isValid) {
                await ctx.reply(`Transaction validation failed: ${validationResult.error}`);
                return;
            }

            // Store transaction details
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

            // Prepare response message
            let responseMessage = `Thank you, ${ctx.session.verifiedName}. We have received your transaction:\n\n`;
            responseMessage += `Type: ${validationResult.type === 'native' ? 'Native token' : 'Token'} transfer\n`;
            responseMessage += `Amount: ${validationResult.amount} ${validationResult.type === 'native' ? validationResult.chain.toUpperCase() : 'tokens'}\n`;
            responseMessage += `Status: ${validationResult.status}\n`;
            responseMessage += `From: ${validationResult.from}\n`;
            responseMessage += `To: ${validationResult.to}\n`;

            if (validationResult.type === 'token') {
                responseMessage += `Token Address: ${validationResult.tokenAddress}\n`;
            }

            responseMessage += `\nCurrent status: ${validationResult.status}. You will receive a confirmation in your bank account (${ctx.session.accountNumber}) once the transaction is fully processed.`;

            await ctx.reply(responseMessage);

            // Log transaction details
            logger.info('Transaction details stored', { 
                userId: ctx.from.id, 
                hash: hash, 
                ...ctx.session.transactions[hash]
            });

            await generateMainMenu(ctx);
            return ctx.scene.leave();
        } catch (error) {
            logger.error('Error in transaction handler', {
                userId: ctx.from?.id,
                error: error.message,
                stack: error.stack
            });
            await ctx.reply('An unexpected error occurred while processing your transaction. Our team has been notified. Please try again later or contact support.');
            await generateMainMenu(ctx);
            return ctx.scene.leave();
        }
    }
);

// New scene for detailed transaction status checking
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
                               `Account Name: ${ctx.session.verifiedName}\n` +
                               `Account Number: ${ctx.session.accountNumber}\n`;
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

const stage = new Scenes.Stage([sendCryptoScene, checkTransactionScene]);
bot.use(stage.middleware());

bot.action('send_crypto', async (ctx) => {
    try {
        await ctx.scene.enter('SEND_CRYPTO');
    } catch (error) {
        logger.error('Error entering send crypto scene', { error: error.message, userId: ctx.from.id });
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