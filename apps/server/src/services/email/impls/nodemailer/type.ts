/**
 * Nodemailer SMTP transport configuration
 */
export interface NodemailerConfig {
  /**
   * Authentication credentials
   */
  auth?: {
    pass: string;
    user: string;
  };
  /**
   * SMTP server hostname
   */
  host?: string;
  /**
   * SMTP server port
   * @default 587
   */
  port?: number;
  /**
   * Use TLS connection
   * @default false
   */
  secure?: boolean;
  /**
   * Well-known service name (e.g., 'Gmail', 'SendGrid')
   * When set, overrides host, port, and secure
   */
  service?: string;
}
