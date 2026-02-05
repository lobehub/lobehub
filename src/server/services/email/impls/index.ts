import { NodemailerImpl } from './nodemailer';
import { ResendImpl } from './resend';
import type {EmailServiceImpl} from './type';

/**
 * Available email service implementations
 */
export enum EmailImplType {
  Nodemailer = 'nodemailer',
  Resend = 'resend',
  // Future providers can be added here:
  // SendGrid = 'sendgrid',
}

/**
 * Create an email service implementation instance
 */
export const createEmailServiceImpl = (
  type: EmailImplType = EmailImplType.Nodemailer,
): EmailServiceImpl => {
  switch (type) {
    case EmailImplType.Nodemailer: {
      return new NodemailerImpl();
    }
    case EmailImplType.Resend: {
      return new ResendImpl();
    }

    default: {
      return new NodemailerImpl();
    }
  }
};

export type { EmailServiceImpl } from './type';
export type { EmailPayload, EmailResponse } from './type';
