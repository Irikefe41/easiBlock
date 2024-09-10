import { expect } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chai from 'chai';
import { ethers } from 'ethers';
import Web3 from 'web3';
import * as solanaWeb3 from '@solana/web3.js';
import TronWeb from 'tronweb';

chai.use(sinonChai);

import UnifiedWalletService from '../services/unifiedWalletService';

describe('UnifiedWalletService', function() {
  let unifiedWalletService;
  let ethersStub, web3Stub, solanaStub, tronWebStub;

  beforeEach(function() {
    // Create stubs for external dependencies
    ethersStub = {
      Wallet: {
        createRandom: sinon.stub().returns({ address: '0xEthAddress' }),
      },
      providers: {
        JsonRpcProvider: sinon.stub().returns({
          getBalance: sinon.stub().resolves(ethers.BigNumber.from('1000000000000000000')),
        }),
      },
      utils: {
        parseEther: sinon.stub().returns(ethers.BigNumber.from('1000000000000000000')),
        formatEther: sinon.stub().callsFake((value) => ethers.utils.formatEther(value)),
      },
    };

    web3Stub = {
      eth: {
        accounts: {
          create: sinon.stub().returns({ address: '0xBscAddress' }),
        },
        getBalance: sinon.stub().resolves('1000000000000000000'),
        sendTransaction: sinon.stub().resolves({ transactionHash: 'bscTxHash' }),
      },
      utils: {
        toWei: sinon.stub().returns('1000000000000000000'),
        fromWei: sinon.stub().returns('1.0'),
      },
    };

    solanaStub = {
      Keypair: {
        generate: sinon.stub().returns({ publicKey: { toBase58: () => 'SolanaAddress' } }),
      },
      Connection: sinon.stub().returns({
        getBalance: sinon.stub().resolves(1000000000),
        sendTransaction: sinon.stub().resolves('solTxHash'),
      }),
      SystemProgram: {
        transfer: sinon.stub().returns({ instructions: [] }),
      },
      Transaction: sinon.stub().returns({
        add: sinon.stub(),
        sign: sinon.stub(),
      }),
      sendAndConfirmTransaction: sinon.stub().resolves('solTxHash'),
      LAMPORTS_PER_SOL: 1000000000,
    };

    tronWebStub = {
      createAccount: sinon.stub().resolves({ address: { base58: 'TronAddress' } }),
      trx: {
        getBalance: sinon.stub().resolves(1000000),
        sendTransaction: sinon.stub().resolves({ txid: 'tronTxHash' }),
      },
    };

    // Create instance of UnifiedWalletService with stubbed dependencies
    unifiedWalletService = new UnifiedWalletService(ethersStub, web3Stub, solanaStub, tronWebStub);
  });

  describe('getDepositAddress', function() {
    it('should return a valid Ethereum deposit address', async function() {
      const result = await unifiedWalletService.getDepositAddress('user123', 'ethereum');
      expect(result).to.have.property('address').that.equals('0xEthAddress');
      expect(result).to.have.property('memo').that.is.a('string');
    });

    it('should return a valid BSC deposit address', async function() {
      const result = await unifiedWalletService.getDepositAddress('user123', 'bsc');
      expect(result).to.have.property('address').that.equals('0xBscAddress');
      expect(result).to.have.property('memo').that.is.a('string');
    });

    it('should return a valid Solana deposit address', async function() {
      const result = await unifiedWalletService.getDepositAddress('user123', 'solana');
      expect(result).to.have.property('address').that.equals('SolanaAddress');
      expect(result).to.have.property('memo').that.is.a('string');
    });

    it('should return a valid Tron deposit address', async function() {
      const result = await unifiedWalletService.getDepositAddress('user123', 'tron');
      expect(result).to.have.property('address').that.equals('TronAddress');
      expect(result).to.have.property('memo').that.is.a('string');
    });

    it('should throw an error for an unsupported blockchain', async function() {
      await expect(unifiedWalletService.getDepositAddress('user123', 'unsupported'))
        .to.be.rejectedWith('Unsupported blockchain');
    });

    it('should return the same address for the same user and blockchain', async function() {
      const result1 = await unifiedWalletService.getDepositAddress('user123', 'ethereum');
      const result2 = await unifiedWalletService.getDepositAddress('user123', 'ethereum');
      expect(result1.address).to.equal(result2.address);
    });

    it('should return different addresses for different users on the same blockchain', async function() {
      const result1 = await unifiedWalletService.getDepositAddress('user123', 'ethereum');
      const result2 = await unifiedWalletService.getDepositAddress('user456', 'ethereum');
      expect(result1.address).to.not.equal(result2.address);
    });
  });

  describe('getBalance', function() {
    it('should return the correct balance for Ethereum', async function() {
      const balance = await unifiedWalletService.getBalance('0xEthAddress', 'ethereum');
      expect(balance).to.equal('1.0');
    });

    it('should return the correct balance for BSC', async function() {
      const balance = await unifiedWalletService.getBalance('0xBscAddress', 'bsc');
      expect(balance).to.equal('1.0');
    });

    it('should return the correct balance for Solana', async function() {
      const balance = await unifiedWalletService.getBalance('SolanaAddress', 'solana');
      expect(balance).to.equal('1.0');
    });

    it('should return the correct balance for Tron', async function() {
      const balance = await unifiedWalletService.getBalance('TronAddress', 'tron');
      expect(balance).to.equal('1.0');
    });

    it('should throw an error for an unsupported blockchain', async function() {
      await expect(unifiedWalletService.getBalance('address', 'unsupported'))
        .to.be.rejectedWith('Unsupported blockchain');
    });

    it('should handle zero balances correctly', async function() {
      ethersStub.providers.JsonRpcProvider().getBalance.resolves(ethers.BigNumber.from('0'));
      const balance = await unifiedWalletService.getBalance('0xEthAddress', 'ethereum');
      expect(balance).to.equal('0.0');
    });

    it('should handle very large balances correctly', async function() {
      ethersStub.providers.JsonRpcProvider().getBalance.resolves(ethers.BigNumber.from('1000000000000000000000000'));
      const balance = await unifiedWalletService.getBalance('0xEthAddress', 'ethereum');
      expect(balance).to.equal('1000000.0');
    });
  });

  describe('transferFunds', function() {
    it('should successfully transfer funds on Ethereum', async function() {
      ethersStub.Wallet.prototype.sendTransaction = sinon.stub().resolves({ hash: 'ethTxHash' });
      const result = await unifiedWalletService.transferFunds('ethereum', '0xFromAddress', '0xToAddress', '1.0');
      expect(result).to.equal('ethTxHash');
    });

    it('should successfully transfer funds on BSC', async function() {
      const result = await unifiedWalletService.transferFunds('bsc', '0xFromAddress', '0xToAddress', '1.0');
      expect(result).to.equal('bscTxHash');
    });

    it('should successfully transfer funds on Solana', async function() {
      const result = await unifiedWalletService.transferFunds('solana', 'FromSolanaAddress', 'ToSolanaAddress', '1.0');
      expect(result).to.equal('solTxHash');
    });

    it('should successfully transfer funds on Tron', async function() {
      const result = await unifiedWalletService.transferFunds('tron', 'FromTronAddress', 'ToTronAddress', '1.0');
      expect(result).to.equal('tronTxHash');
    });

    it('should throw an error for insufficient funds', async function() {
      ethersStub.Wallet.prototype.sendTransaction = sinon.stub().rejects(new Error('insufficient funds'));
      await expect(unifiedWalletService.transferFunds('ethereum', '0xFromAddress', '0xToAddress', '1000000.0'))
        .to.be.rejectedWith('Insufficient funds for transfer');
    });

    it('should throw an error for an invalid recipient address', async function() {
      await expect(unifiedWalletService.transferFunds('ethereum', '0xFromAddress', 'invalidAddress', '1.0'))
        .to.be.rejectedWith('Invalid recipient address');
    });

    it('should throw an error for an unsupported blockchain', async function() {
      await expect(unifiedWalletService.transferFunds('unsupported', '0xFromAddress', '0xToAddress', '1.0'))
        .to.be.rejectedWith('Unsupported blockchain');
    });
  });

  // Additional test cases can be added here for any other methods in UnifiedWalletService
});