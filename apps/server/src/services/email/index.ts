import { emailEnv } from '@/envs/email';
import { EMAIL_SUPPORT_REPLY_TO } from '@/libs/email/support';

import { type EmailPayload, type EmailResponse, type EmailServiceImpl } from './impls';
import { createEmailServiceImpl, EmailImplType } from './impls';

/**
 * Email service class
 * Provides email sending functionality with multiple provider support
 */
export class EmailService {
  private emailImpl: EmailServiceImpl;

  constructor(implType?: EmailImplType) {
    // Avoid client-side access to server env when executed in browser-like test environments
    const envImplType =
      typeof window === 'undefined'
        ? (emailEnv.EMAIL_SERVICE_PROVIDER as EmailImplType | undefined)
        : undefined;
    const resolvedImplType = implType ?? envImplType ?? EmailImplType.Nodemailer;

    this.emailImpl = createEmailServiceImpl(resolvedImplType);
  }

  /**
   * Send an email
   */
  async sendMail(payload: EmailPayload): Promise<EmailResponse> {
    const replyTo = payload.replyTo || EMAIL_SUPPORT_REPLY_TO;

    return this.emailImpl.sendMail(replyTo ? { ...payload, replyTo } : payload);
  }

  /**
   * Verify the email service configuration
   * Note: Only available for Nodemailer implementation
   */
  async verify(): Promise<boolean> {
    // Check if the implementation has a verify method
    if ('verify' in this.emailImpl && typeof this.emailImpl.verify === 'function') {
      return this.emailImpl.verify();
    }

    // For implementations without verify, assume it's valid
    return true;
  }
}

// Export types
export type { EmailPayload, EmailResponse } from './impls';
export { EmailImplType } from './impls';
