import { DebugSmsService } from './debug';
import { KavenegarSmsService } from './kavenegar';
import { type SmsServiceImpl } from './type';

export enum SmsImplType {
  Debug = 'debug',
  Kavenegar = 'kavenegar',
}

export const createSmsServiceImpl = (implType?: SmsImplType): SmsServiceImpl => {
  // Call-time read — avoid relying on module-init smsEnv (Next env load order)
  const apiKey = process.env.KAVENEGAR_API_KEY?.trim();
  const resolved = implType ?? (apiKey ? SmsImplType.Kavenegar : SmsImplType.Debug);

  if (resolved === SmsImplType.Kavenegar) {
    console.info('[sms] using Kavenegar provider');
    return new KavenegarSmsService(apiKey);
  }

  console.warn('[sms] using debug provider (set KAVENEGAR_API_KEY to send real SMS)');
  return new DebugSmsService();
};

export { toKavenegarReceptor } from './kavenegar';
export type { SmsPayload, SmsResponse, SmsServiceImpl } from './type';
