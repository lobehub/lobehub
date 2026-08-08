import debug from 'debug';

import { type SmsPayload, type SmsResponse, type SmsServiceImpl } from './type';

const log = debug('lobe-sms:debug');

/**
 * Dev/fallback SMS impl — logs the OTP via the `debug` namespace instead of sending.
 * Never enable as the sole provider in production (see `createSmsServiceImpl`).
 * Never write OTP codes to stdout/`console.*` — log aggregators must not retain secrets.
 */
export class DebugSmsService implements SmsServiceImpl {
  async sendSms(payload: SmsPayload): Promise<SmsResponse> {
    // Opt-in via DEBUG=lobe-sms:debug (local QA). Do not use console.info — OTPs are secrets.
    log('SMS (debug) to=%s code=%s message=%s', payload.to, payload.code, payload.message);
    return { messageId: `debug-${Date.now()}`, provider: 'debug' };
  }
}
