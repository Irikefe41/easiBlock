const axios = require('axios');
const logger = require('../utils/logger');

require('dotenv').config()

class BankVerificationService {
  constructor() {
    this.apiKey = process.env.PAYSTACK_SECRET_KEY;
    this.baseUrl = 'https://api.paystack.co';
    this.bankList = [];
    this.lastFetchTime = null;
    this.isTestMode = process.env.NODE_ENV !== 'production';
  }

  async initializeBankList() {
    if (this.isTestMode) {
      this.bankList = this.getMockBankList();
      logger.info('Mock bank list initialized');
    } else if (this.bankList.length === 0 || this.isCacheExpired()) {
      try {
        const response = await axios.get(`${this.baseUrl}/bank`, {
          headers: { Authorization: `Bearer ${this.apiKey}` }
        });
        this.bankList = response.data.data.sort((a, b) => a.name.localeCompare(b.name));
        this.lastFetchTime = Date.now();
        logger.info('Bank list fetched and cached');
      } catch (error) {
        this.handleAxiosError(error, 'Error fetching bank list');
        throw new Error('Unable to fetch bank list');
      }
    }
  }

  getMockBankList() {
    return [
      { id: 1, name: 'Mock Bank A', code: 'MBA' },
      { id: 2, name: 'Mock Bank B', code: 'MBB' },
      { id: 3, name: 'Mock Bank C', code: 'MBC' },
    ];
  }

  isCacheExpired() {
    return !this.lastFetchTime || (Date.now() - this.lastFetchTime > 24 * 60 * 60 * 1000);
  }

  getBankListPage(page, pageSize = 10) {
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return this.bankList.slice(startIndex, endIndex);
  }

  getTotalPages(pageSize = 10) {
    return Math.ceil(this.bankList.length / pageSize);
  }

  async verifyAccount(accountNumber, bankCode) {
    if (this.isTestMode) {
      return this.mockVerifyAccount(accountNumber, bankCode);
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
        {
          headers: { Authorization: `Bearer ${this.apiKey}` }
        }
      );
      return {
        accountName: response.data.data.account_name,
        accountNumber: response.data.data.account_number,
        bankId: response.data.data.bank_id
      };
    } catch (error) {
      this.handleAxiosError(error, 'Error verifying bank account');
      throw new Error('Unable to verify bank account');
    }
  }

  mockVerifyAccount(accountNumber, bankCode) {
    const mockAccounts = {
      '0123456789': { accountName: 'John Doe', bankId: 'MBA' },
      '9876543210': { accountName: 'Jane Smith', bankId: 'MBB' },
    };

    if (mockAccounts[accountNumber] && mockAccounts[accountNumber].bankId === bankCode) {
      return {
        accountName: mockAccounts[accountNumber].accountName,
        accountNumber: accountNumber,
        bankId: mockAccounts[accountNumber].bankId
      };
    } else {
      throw new Error('Invalid account details');
    }
  }

  handleAxiosError(error, message) {
    if (error.response) {
      logger.error(`${message}: ${error.response.status} - ${error.response.data.message || JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      logger.error(`${message}: No response received`);
    } else {
      logger.error(`${message}: ${error.message}`);
    }
  }
}

module.exports = new BankVerificationService();