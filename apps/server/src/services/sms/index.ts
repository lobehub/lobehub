import type { SmsImplType, SmsPayload, SmsResponse, SmsServiceImpl } from './impls';
import { createSmsServiceImpl } from './impls';
import { DebugSmsService } from './impls/debug';

/**
 * SMS service — Kavenegar when `KAVENEGAR_API_KEY` is set, otherwise debug logger.
 * When `AUTH_SMS_DEBUG_OTP=1` in non-production, also mirrors OTP to the debug impl (local QA).
 * The mirror is ignored in production even if the env flag is set (MON-001).
 */
export class SmsService {
  private smsImpl: SmsServiceImpl;
  private debugMirror: DebugSmsService | null;

  constructor(implType?: SmsImplType) {
    this.smsImpl = createSmsServiceImpl(implType);
    const isProduction = process.env.NODE_ENV === 'production';
    const debugOtp =
      !isProduction &&
      (process.env.AUTH_SMS_DEBUG_OTP === '1' || process.env.AUTH_SMS_DEBUG_OTP === 'true');
    this.debugMirror = debugOtp ? new DebugSmsService() : null;
  }

  async sendSms(payload: SmsPayload): Promise<SmsResponse> {
    if (this.debugMirror) {
      await this.debugMirror.sendSms(payload).catch(() => undefined);
    }
    return this.smsImpl.sendSms(payload);
  }

  async sendOtp(phoneNumber: string, code: string): Promise<SmsResponse> {
    return this.sendSms({
      code,
      message: `کد تایید شما: ${code}`,
      to: phoneNumber,
    });
  }
}

export type { SmsPayload, SmsResponse } from './impls';
export { SmsImplType, toKavenegarReceptor } from './impls';
