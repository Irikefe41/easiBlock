const axios = require('axios');
const logger = require('./logger');

class BankVerificationService {
  constructor() {
    this.apiKey = process.env.PAYSTACK_SECRET_KEY;
    this.baseUrl = 'https://api.paystack.co';
    this.bankList = [];
    this.lastFetchTime = null;
  }

  async initializeBankList() {
    if (this.bankList.length === 0 || this.isCacheExpired()) {
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

  isCacheExpired() {
    // Refresh cache every 24 hours
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
      if (error.response && error.response.status === 422) {
        throw new Error('Invalid account details');
      }
      throw new Error('Unable to verify bank account');
    }
  }

  handleAxiosError(error, message) {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      logger.error(`${message}: ${error.response.status} - ${error.response.data.message || JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      // The request was made but no response was received
      logger.error(`${message}: No response received`);
    } else {
      // Something happened in setting up the request that triggered an Error
      logger.error(`${message}: ${error.message}`);
    }
  }
}

module.exports = new BankVerificationService();