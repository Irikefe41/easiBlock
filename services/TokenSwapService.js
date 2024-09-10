const { ethers } = require('ethers');
const Web3 = require('web3');
const { Connection, PublicKey, Transaction } = require('@solana/web3.js');
const TronWeb = require('tronweb');
const axios = require('axios');


require('dotenv').config();

class TokenSwapService {
  constructor() {
    this.dexAddresses = {
        ethereum: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 Router
        bsc: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap V2 Router
        solana: 'DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe', // Raydium Swap Program
        tron: 'TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax', // SunSwap
      };

    this.providers = {
      ethereum: new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL),
      bsc: new Web3(process.env.BSC_RPC_URL),
      solana: new Connection(process.env.SOLANA_RPC_URL),
      tron: new TronWeb(process.env.TRON_FULL_NODE, process.env.TRON_SOLIDITY_NODE, process.env.TRON_EVENT_SERVER)
    };

    this.wallets = {
      ethereum: new ethers.Wallet(process.env.ETHEREUM_PRIVATE_KEY, this.providers.ethereum),
      bsc: new ethers.Wallet(process.env.BSC_PRIVATE_KEY, this.providers.bsc),
      solana: process.env.SOLANA_PRIVATE_KEY, // Solana uses a different approach for transactions
      tron: process.env.TRON_PRIVATE_KEY
    };

    this.usdtAddresses = {
        ethereum: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        bsc: '0x55d398326f99059fF775485246999027B3197955',
        solana: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        tron: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      };
  }

  async swapToUSDT(tokenAddress, amount, chain) {
    // Check if the token is already USDT
    if (tokenAddress.toLowerCase() === this.usdtAddresses[chain].toLowerCase()) {
      console.log("Token is already USDT. No swap needed.");
      return { success: true, message: "Token is already USDT" };
    }

    switch (chain) {
      case 'ethereum':
      case 'bsc':
        return this.swapEVM(tokenAddress, amount, chain);
      case 'solana':
        return this.swapSolana(tokenAddress, amount);
      case 'tron':
        return this.swapTron(tokenAddress, amount);
      default:
        throw new Error(`Unsupported chain: ${chain}`);
    }
  }

  async swapEVM(tokenAddress, amount, chain) {
    const provider = this.providers[chain];
    const wallet = this.wallets[chain];
    const dexAddress = this.dexAddresses[chain];
    const usdtAddress = this.usdtAddresses[chain];

    // ABI for the swap function (this is a simplified example, actual ABI may vary)
    const dexABI = [
      "function swap(address tokenIn, address tokenOut, uint256 amountIn) external returns (uint256 amountOut)"
    ];

    const dexContract = new ethers.Contract(dexAddress, dexABI, wallet);

    try {
      // Approve the DEX to spend tokens (if needed)
      const tokenContract = new ethers.Contract(tokenAddress, ["function approve(address spender, uint256 amount) public returns (bool)"], wallet);
      await tokenContract.approve(dexAddress, amount);

      // Perform the swap
      const tx = await dexContract.swap(tokenAddress, usdtAddress, amount);
      const receipt = await tx.wait();

      return {
        success: true,
        transactionHash: receipt.transactionHash,
        message: `Swapped to USDT on ${chain}`
      };
    } catch (error) {
      console.error(`Swap error on ${chain}:`, error);
      return { success: false, error: error.message };
    }
  }

  async swapSolana(tokenAddress, amount) {
    // This is a simplified example. In reality, you'd need to use a Solana DEX SDK or create a more complex transaction.
    try {
      const connection = this.providers.solana;
      const wallet = new solanaWeb3.Keypair.fromSecretKey(new Uint8Array(JSON.parse(this.wallets.solana)));
      
      // Create a transaction (this is a placeholder, you'd need to construct the actual swap instruction)
      const transaction = new Transaction().add(
        // Add swap instruction here
      );

      // Sign and send the transaction
      const signature = await solanaWeb3.sendAndConfirmTransaction(
        connection,
        transaction,
        [wallet]
      );

      return {
        success: true,
        transactionHash: signature,
        message: "Swapped to USDT on Solana"
      };
    } catch (error) {
      console.error("Swap error on Solana:", error);
      return { success: false, error: error.message };
    }
  }

  async swapTron(tokenAddress, amount) {
    try {
      const tronWeb = this.providers.tron;
      tronWeb.setPrivateKey(this.wallets.tron);

      const contract = await tronWeb.contract().at(this.dexAddresses.tron);
      
      // This is a simplified example. You'd need to adjust based on the actual DEX contract methods
      const transaction = await contract.swap(tokenAddress, this.usdtAddresses.tron, amount).send();

      return {
        success: true,
        transactionHash: transaction.txid,
        message: "Swapped to USDT on Tron"
      };
    } catch (error) {
      console.error("Swap error on Tron:", error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = TokenSwapService;