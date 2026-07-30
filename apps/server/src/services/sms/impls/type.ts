export interface SmsPayload {
  /**
   * OTP code — used when a provider template requires a token field.
   */
  code?: string;
  /**
   * Plain-text message body (used by the generic send API).
   */
  message: string;
  /**
   * Destination phone number. Implementations normalize as needed.
   * Prefer E.164 (e.g. `+989121234567`).
   */
  to: string;
}

export interface SmsResponse {
  messageId?: string;
  provider: 'kavenegar' | 'debug';
}

export interface SmsServiceImpl {
  sendSms: (payload: SmsPayload) => Promise<SmsResponse>;
}
