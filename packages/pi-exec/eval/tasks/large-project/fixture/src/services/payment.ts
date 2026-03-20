import { Logger } from "../utils/logger.js";

export class PaymentService {
  private logger = new Logger("PaymentService");

  async charge(userId: string, amount: number): Promise<{ transactionId: string }> {
    this.logger.info(`Charging user ${userId}: $${amount}`);
    return { transactionId: `txn_${Date.now()}` };
  }

  async refund(transactionId: string): Promise<boolean> {
    this.logger.info(`Refunding ${transactionId}`);
    return true;
  }
}
