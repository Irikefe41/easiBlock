const { Connection } = require('@solana/web3.js');
const TronWeb = require('tronweb');
const { ethers } = require('ethers');

require('dotenv').config();

class UnifiedWalletService {
    constructor() {
      this.solanaConnection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
      this.ethProvider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
      this.bscProvider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL);
      this.tronWeb = new TronWeb(process.env.TRON_FULL_NODE, process.env.TRON_SOLIDITY_NODE, process.env.TRON_EVENT_SERVER);

      // Initialize with your main wallet addresses
      this.wallets = {
        solana: process.env.SOLANA_WALLET_ADDRESS,
        ethereum: process.env.ETH_WALLET_ADDRESS,
        bsc: process.env.BSC_WALLET_ADDRESS,
        tron: process.env.TRON_WALLET_ADDRESS
      };
    }

    async generateMemo(userId, blockchain) {
      // Generate a unique memo for the user and blockchain
      return `${userId}-${blockchain}-${Date.now()}`;
    }

    async getDepositAddress(userId, blockchain) {
      const memo = await this.generateMemo(userId, blockchain);
      return {
        address: this.wallets[blockchain],
        memo: memo
      };
    }

    // Add methods for checking balances, validating transactions, etc.
    async getEthereumBalance(address) {
      const balance = await this.ethProvider.getBalance(address);
      return ethers.formatEther(balance);
    }

    async getBscBalance(address) {
      const balance = await this.bscProvider.getBalance(address);
      return ethers.formatEther(balance);
    }

    // You can add more methods here for other functionalities
}

module.exports = new UnifiedWalletService();