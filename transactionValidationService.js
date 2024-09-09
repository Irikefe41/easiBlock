const { ethers } = require('ethers');
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const TronWeb = require('tronweb');
const axios = require('axios');
const logger = require('./logger');

require('dotenv').config()

class TransactionValidationService {
  constructor() {
    this.providers = {
      ethereum: new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL),
      bsc: new ethers.JsonRpcProvider(process.env.BSC_RPC_URL),
      solana: new Connection(process.env.SOLANA_RPC_URL),
      tron: new TronWeb(process.env.TRON_FULL_NODE, process.env.TRON_SOLIDITY_NODE, process.env.TRON_EVENT_SERVER)
    };
    this.ERC20_TRANSFER_EVENT = 'Transfer(address,address,uint256)';
  }

  extractTransactionHash (input){
    // Trim the input and convert to lowercase for easier processing
    const cleanInput = input.trim().toLowerCase();
  
    // Regular expressions for different blockchain explorer URLs and hash formats
    const patterns = {
      ethereum: {
        url: /(?:https?:\/\/(?:www\.)?etherscan\.io\/tx\/)(0x[a-fA-F0-9]{64})/,
        hash: /^0x[a-fA-F0-9]{64}$/
      },
      bsc: {
        url: /(?:https?:\/\/(?:www\.)?bscscan\.com\/tx\/)(0x[a-fA-F0-9]{64})/,
        hash: /^0x[a-fA-F0-9]{64}$/
      },
      solana: {
        url: /(?:https?:\/\/(?:www\.)?solscan\.io\/tx\/)([1-9A-HJ-NP-Za-km-z]{88,98})/,
        hash: /^[1-9A-HJ-NP-Za-km-z]{88,98}$/
      },
      tron: {
        url: /(?:https?:\/\/(?:www\.)?tronscan\.org\/#\/transaction\/)([a-fA-F0-9]{64})/,
        hash: /^[a-fA-F0-9]{64}$/
      }
    };
  
    for (const [chain, pattern] of Object.entries(patterns)) {
      // Check if the input is a full URL
      const urlMatch = cleanInput.match(pattern.url);
      if (urlMatch) {
        return { hash: urlMatch[1], chain };
      }
      
      // Check if the input is just the hash
      if (pattern.hash.test(cleanInput)) {
        return { hash: cleanInput, chain };
      }
    }
  
    // If no match is found, return null
    return null;
  };
  
  // Function to provide guidance on transaction hashes
   getTransactionHashGuidance () {
    return `A transaction hash is a unique identifier for a blockchain transaction. Here's how to find it:
  
          1. Ethereum/BSC: It starts with '0x' and is 66 characters long. Explorer is etherscan.io or bscscan.io
          2. Solana: It's 88 characters long and contains letters and numbers. Explorer is Solscan.io
          3. Tron: It's 64 characters long and contains only letters and numbers. Explorer is Tronscan.org
          
          You can usually find the transaction hash on the page where you made the transaction or in your wallet's transaction history.
          
          For more help, check these guides:
          - Ethereum: https://support.metamask.io/hc/en-us/articles/4413442094235-How-to-find-a-transaction-hash-ID
          - Solana: https://docs.solana.com/terminology#transaction-id
          - Tron: https://support.blockchain.com/hc/en-us/articles/360018779062-Locating-a-TRON-transaction-hash`;
  };

  async validateTransaction(hash, chain, expectedRecipient) {
    try {
      switch(chain) {
        case 'bsc':
        case 'ethereum':
          return await this.validateEVMTransaction(hash, chain, expectedRecipient);
        case 'solana':
          return await this.validateSolanaTransaction(hash, expectedRecipient);
        case 'tron':
          return await this.validateTronTransaction(hash, expectedRecipient);
        default:
          return { isValid: false, error: 'Unsupported blockchain' };
      }
    } catch (error) {
      logger.error('Error validating transaction:', error);
      return { isValid: false, error: 'Validation error: ' + error.message };
    }
  }

  async validateEVMTransaction(hash, chain, expectedRecipient) {
    const provider = (chain === 'bsc') ? this.providers.bsc : this.providers.ethereum;
    const tx = await provider.getTransaction(hash);
    if (!tx) {
      return { isValid: false, error: 'Transaction not found' };
    }
    const receipt = await provider.getTransactionReceipt(hash);
    const status = receipt ? (receipt.status === 1 ? 'Confirmed' : 'Failed') : 'Pending';

    let transferDetails;
    if (tx.value > 0) {
      // Native token transfer
      transferDetails = {
        type: 'native',
        from: tx.from,
        to: tx.to,
        amount: ethers.formatEther(tx.value),
        tokenAddress: null
      };
    } else {
      // Check for ERC20 token transfer
      const transferLog = receipt.logs.find(log => 
        log.topics[0] === ethers.id(this.ERC20_TRANSFER_EVENT)
      );
      if (transferLog) {
        const decodedLog = ethers.AbiCoder.defaultAbiCoder().decode(
          ['address', 'address', 'uint256'],
          transferLog.data,
          transferLog.topics.slice(1)
        );
        transferDetails = {
          type: 'token',
          from: decodedLog[0],
          to: decodedLog[1],
          amount: ethers.formatUnits(decodedLog[2], 18), // Assuming 18 decimals
          tokenAddress: transferLog.address
        };
      } else {
        return { isValid: false, error: 'No transfer found in transaction' };
      }
    }

    const isCorrectRecipient = transferDetails.to.toLowerCase() === expectedRecipient.toLowerCase();

    return { 
      isValid: isCorrectRecipient, 
      status, 
      chain,
      ...transferDetails,
      error: isCorrectRecipient ? null : 'Transaction recipient does not match expected address'
    };
  }

  async validateSolanaTransaction(hash, expectedRecipient) {
    try {
      const connection = this.providers.solana;
      logger.info(`Fetching Solana transaction: ${hash}`);
      const tx = await connection.getParsedTransaction(hash, { maxSupportedTransactionVersion: 0 });
      
      if (!tx) {
        logger.error(`Solana transaction not found: ${hash}`);
        return { isValid: false, error: 'Transaction not found' };
      }
  
      logger.info(`Solana transaction fetched successfully: ${hash}`);
      const status = tx.meta.err ? 'Failed' : 'Confirmed';
      let transferDetails = null;
  
      if (!tx.transaction.message.instructions || tx.transaction.message.instructions.length === 0) {
        logger.error(`No instructions found in Solana transaction: ${hash}`);
        return { isValid: false, error: 'No instructions found in transaction' };
      }
  
      for (const instruction of tx.transaction.message.instructions) {
        logger.info(`Processing instruction: ${JSON.stringify(instruction)}`);
        
        if (instruction.program === 'system' && instruction.parsed.type === 'transfer') {
          // Native SOL transfer
          transferDetails = {
            type: 'native',
            from: instruction.parsed.info.source,
            to: instruction.parsed.info.destination,
            amount: instruction.parsed.info.lamports / LAMPORTS_PER_SOL,
            tokenAddress: null
          };
          logger.info(`Native SOL transfer detected: ${JSON.stringify(transferDetails)}`);
          break;
        } else if (instruction.program === 'spl-token' && instruction.parsed.type === 'transfer') {
          // SPL token transfer
          transferDetails = {
            type: 'token',
            from: instruction.parsed.info.source,
            to: instruction.parsed.info.destination,
            amount: instruction.parsed.info.amount,
            tokenAddress: instruction.parsed.info.mint
          };
          logger.info(`SPL token transfer detected: ${JSON.stringify(transferDetails)}`);
          break;
        }
      }
  
      if (!transferDetails) {
        logger.error(`No transfer found in Solana transaction: ${hash}`);
        return { isValid: false, error: 'No transfer found in transaction' };
      }
  
      const isCorrectRecipient = transferDetails.to === expectedRecipient;
      logger.info(`Recipient validation: expected=${expectedRecipient}, actual=${transferDetails.to}, isCorrect=${isCorrectRecipient}`);
  
      return { 
        isValid: isCorrectRecipient, 
        status,
        chain: 'solana',
        ...transferDetails,
        error: isCorrectRecipient ? null : 'Transaction recipient does not match expected address'
      };
    } catch (error) {
      logger.error(`Error in validateSolanaTransaction: ${error.message}`, { stack: error.stack });
      return { isValid: false, error: `Validation error: ${error.message}` };
    }
  }

  async validateTronTransaction(hash, expectedRecipient) {
    const tx = await this.providers.tron.trx.getTransaction(hash);
    if (!tx) {
      return { isValid: false, error: 'Transaction not found' };
    }
    const status = tx.ret[0].contractRet === 'SUCCESS' ? 'Confirmed' : 'Failed';

    let transferDetails;
    if (tx.raw_data.contract[0].type === 'TransferContract') {
      // Native TRX transfer
      const { amount, to_address, owner_address } = tx.raw_data.contract[0].parameter.value;
      transferDetails = {
        type: 'native',
        from: this.providers.tron.address.fromHex(owner_address),
        to: this.providers.tron.address.fromHex(to_address),
        amount: this.providers.tron.fromSun(amount),
        tokenAddress: null
      };
    } else if (tx.raw_data.contract[0].type === 'TriggerSmartContract') {
      // TRC20 token transfer
      const { contract_address, data } = tx.raw_data.contract[0].parameter.value;
      if (data.startsWith('a9059cbb')) { // Transfer method signature
        const to = '41' + data.substr(32, 40);
        const amount = parseInt(data.substr(72), 16);
        transferDetails = {
          type: 'token',
          from: this.providers.tron.address.fromHex(tx.raw_data.contract[0].parameter.value.owner_address),
          to: this.providers.tron.address.fromHex(to),
          amount: amount.toString(),
          tokenAddress: this.providers.tron.address.fromHex(contract_address)
        };
      }
    }

    if (!transferDetails) {
      return { isValid: false, error: 'Unsupported transaction type' };
    }

    const isCorrectRecipient = transferDetails.to === expectedRecipient;

    return { 
      isValid: isCorrectRecipient, 
      status, 
      chain: 'tron',
      ...transferDetails,
      error: isCorrectRecipient ? null : 'Transaction recipient does not match expected address'
    };
  }
}

module.exports = new TransactionValidationService();