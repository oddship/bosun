import { Logger } from "../utils/logger.js";

export class EmailService {
  private logger = new Logger("EmailService");

  async send(to: string, subject: string, body: string): Promise<boolean> {
    this.logger.info(`Sending email to ${to}: ${subject}`);
    // Simulate send
    return true;
  }
}
