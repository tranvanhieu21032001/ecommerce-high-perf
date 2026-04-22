import { Injectable, Logger } from '@nestjs/common';

type SendOrderEmailPayload = {
  to: string;
  orderNumber: string;
  totalAmount: number;
  itemCount: number;
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: {
    sendMail: (options: Record<string, unknown>) => Promise<unknown>;
  } | null = null;

  constructor() {
    this.transporter = this.createTransporter();
  }

  async sendOrderConfirmation(payload: SendOrderEmailPayload): Promise<void> {
    const subject = `Order confirmation #${payload.orderNumber}`;
    const text = `Your order #${payload.orderNumber} is confirmed. Total: $${payload.totalAmount.toFixed(
      2,
    )}. Items: ${payload.itemCount}.`;

    if (!this.transporter) {
      this.logger.log(`[Email mock] To=${payload.to}; Subject="${subject}"; Body="${text}"`);
      return;
    }

    await this.transporter.sendMail({
      from: process.env.SMTP_FROM ?? 'no-reply@ecommerce.local',
      to: payload.to,
      subject,
      text,
      html: `<p>Your order <strong>#${payload.orderNumber}</strong> is confirmed.</p><p>Total: <strong>$${payload.totalAmount.toFixed(
        2,
      )}</strong></p><p>Items: ${payload.itemCount}</p>`,
    });
  }

  private createTransporter() {
    try {
      const host = process.env.SMTP_HOST;
      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS;
      const port = Number(process.env.SMTP_PORT ?? 587);

      if (!host || !user || !pass) {
        return null;
      }

      const nodemailer = require('nodemailer') as {
        createTransport: (options: Record<string, unknown>) => {
          sendMail: (options: Record<string, unknown>) => Promise<unknown>;
        };
      };

      return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: {
          user,
          pass,
        },
      });
    } catch {
      return null;
    }
  }
}
