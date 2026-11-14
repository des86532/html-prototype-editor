import nodemailer from 'nodemailer';
import type { SmtpConfig } from './config.js';

export interface Mailer {
  sendMagicLink(email: string, link: string): Promise<void>;
}

/** 只用到 sendMail 的最小 transport 介面（方便以 fake 測試）。 */
export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

export class SmtpMailer implements Mailer {
  constructor(
    private readonly transport: MailTransport,
    private readonly from: string,
  ) {}

  static fromConfig(cfg: SmtpConfig): SmtpMailer {
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass ?? '' } } : {}),
    });
    return new SmtpMailer(transport, cfg.from);
  }

  async sendMagicLink(email: string, link: string): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: email,
      subject: '登入 HTML Prototype Editor',
      text: `點擊下方連結登入（15 分鐘內有效，只能使用一次）：\n\n${link}\n\n如果不是你本人操作，請忽略這封信。`,
    });
  }
}

/** DEV_MAGIC_LINK=true 時使用：不寄信，連結由 API 回應直接帶回。 */
export class NoopMailer implements Mailer {
  async sendMagicLink(): Promise<void> {}
}
