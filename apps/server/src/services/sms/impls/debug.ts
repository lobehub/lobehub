import debug from 'debug';

import { type SmsPayload, type SmsResponse, type SmsServiceImpl } from './type';

const log = debug('lobe-sms:debug');

/**
 * Dev/fallback SMS impl — logs the OTP instead of sending.
 * Never enable as the sole provider in production without a real gateway.
 */
export class DebugSmsService implements SmsServiceImpl {
  async sendSms(payload: SmsPayload): Promise<SmsResponse> {
    log('SMS (debug) to=%s code=%s message=%s', payload.to, payload.code, payload.message);
    // Also surface in stdout so local Phase 1 QA can copy the OTP without DEBUG=*
    console.info(`[sms:debug] OTP for ${payload.to}: ${payload.code ?? '(see message)'}`);
    return { messageId: `debug-${Date.now()}`, provider: 'debug' };
  }
}
