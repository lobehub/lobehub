/**
 * Email message payload
 */
export interface EmailPayload {
  /**
   * Email attachments
   */
  attachments?: Array<{
    content?: Buffer | string;
    filename?: string;
    path?: string;
  }>;
  /**
   * Sender address (defaults to SMTP_USER if not provided)
   */
  from?: string;
  /**
   * HTML body of the email
   */
  html?: string;
  /**
   * Reply-To address
   */
  replyTo?: string;
  /**
   * Subject line
   */
  subject: string;
  /**
   * Plain text body of the email
   */
  text?: string;
  /**
   * Recipient address(es)
   */
  to: string | string[];
}

/**
 * Email send response
 */
export interface EmailResponse {
  /**
   * Message ID assigned by the email service
   */
  messageId: string;
  /**
   * Preview URL for test emails (e.g., Ethereal)
   */
  previewUrl?: string;
}

/**
 * Email service implementation interface
 */
export interface EmailServiceImpl {
  /**
   * Send an email
   */
  sendMail: (payload: EmailPayload) => Promise<EmailResponse>;
}
