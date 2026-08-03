import { DebugSmsService } from './debug';
import { KavenegarSmsService } from './kavenegar';
import { type SmsServiceImpl } from './type';

export enum SmsImplType {
  Debug = 'debug',
  Kavenegar = 'kavenegar',
}

/**
 * Production fails closed without Kavenegar.
 * Debug SMS is never selected when NODE_ENV=production.
 */
export const createSmsServiceImpl = (implType?: SmsImplType): SmsServiceImpl => {
  const apiKey = process.env.KAVENEGAR_API_KEY?.trim();
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    if (implType === SmsImplType.Debug) {
      throw new Error('SMS_DEBUG_FORBIDDEN_IN_PRODUCTION');
    }
    if (!apiKey) {
      throw new Error('KAVENEGAR_API_KEY is required in production — refusing Debug SMS');
    }
    console.info('[sms] using Kavenegar provider');
    return new KavenegarSmsService(apiKey);
  }

  const resolved = implType ?? (apiKey ? SmsImplType.Kavenegar : SmsImplType.Debug);

  if (resolved === SmsImplType.Kavenegar) {
    if (!apiKey) throw new Error('KAVENEGAR_API_KEY is not configured');
    console.info('[sms] using Kavenegar provider');
    return new KavenegarSmsService(apiKey);
  }

  console.warn('[sms] using debug provider (set KAVENEGAR_API_KEY to send real SMS)');
  return new DebugSmsService();
};

export { toKavenegarReceptor } from './kavenegar';
export type { SmsPayload, SmsResponse, SmsServiceImpl } from './type';
