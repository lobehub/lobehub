import debug from 'debug';

import { type SmsPayload, type SmsResponse, type SmsServiceImpl } from './type';

const log = debug('lobe-sms:kavenegar');

const KAVENEGAR_BASE = 'https://api.kavenegar.com/v1';

/** Always read at call-time — Next may load `.env` after module init. */
const getKavenegarConfig = () => ({
  apiKey: process.env.KAVENEGAR_API_KEY?.trim() || undefined,
  otpTemplate: process.env.KAVENEGAR_OTP_TEMPLATE?.trim() || undefined,
  sender: process.env.KAVENEGAR_SENDER?.trim() || undefined,
});

/**
 * Convert E.164 (+98…) / local forms to Kavenegar receptor format (09…).
 * @see https://kavenegar.com/rest.html — receptor formats
 */
export const toKavenegarReceptor = (phone: string): string => {
  const digits = phone.replaceAll(/\D/g, '');
  if (digits.startsWith('98') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith('09') && digits.length === 11) return digits;
  if (digits.startsWith('9') && digits.length === 10) return `0${digits}`;
  return phone;
};

type KavenegarApiResponse = {
  entries?: Array<{ messageid?: number | string }> | { messageid?: number | string };
  return?: { status?: number; message?: string };
};

const extractMessageId = (entries: KavenegarApiResponse['entries']): string | undefined => {
  if (!entries) return undefined;
  if (Array.isArray(entries)) return entries[0]?.messageid?.toString();
  return entries.messageid?.toString();
};

/**
 * Kavenegar REST client — https://kavenegar.com/rest.html
 *
 * OTP path (preferred): POST `/verify/lookup.json` with template + token
 * Plain SMS path: POST `/sms/send.json` with receptor + message (+ optional sender)
 */
export class KavenegarSmsService implements SmsServiceImpl {
  constructor(private readonly apiKeyOverride?: string) {}

  async sendSms(payload: SmsPayload): Promise<SmsResponse> {
    const { apiKey, otpTemplate, sender } = getKavenegarConfig();
    const resolvedKey = this.apiKeyOverride?.trim() || apiKey;

    if (!resolvedKey) {
      throw new Error('KAVENEGAR_API_KEY is not configured');
    }

    const receptor = toKavenegarReceptor(payload.to);

    if (payload.code && otpTemplate) {
      return this.verifyLookup({
        apiKey: resolvedKey,
        code: payload.code,
        receptor,
        template: otpTemplate,
      });
    }

    return this.smsSend({
      apiKey: resolvedKey,
      message: payload.message,
      receptor,
      sender,
    });
  }

  /** https://api.kavenegar.com/v1/{API-KEY}/verify/lookup.json */
  private async verifyLookup(input: {
    apiKey: string;
    code: string;
    receptor: string;
    template: string;
  }): Promise<SmsResponse> {
    const token = input.code.replaceAll(/\s/g, '');
    const body = new URLSearchParams({
      receptor: input.receptor,
      template: input.template,
      token,
      type: 'sms',
    });

    console.info('[sms:kavenegar] verify/lookup', {
      receptor: input.receptor,
      template: input.template,
    });
    log('verify/lookup receptor=%s template=%s', input.receptor, input.template);
    return this.post(input.apiKey, `/verify/lookup.json`, body);
  }

  /** https://api.kavenegar.com/v1/{API-KEY}/sms/send.json */
  private async smsSend(input: {
    apiKey: string;
    message: string;
    receptor: string;
    sender?: string;
  }): Promise<SmsResponse> {
    const body = new URLSearchParams({
      message: input.message,
      receptor: input.receptor,
    });
    if (input.sender) body.set('sender', input.sender);

    console.info('[sms:kavenegar] sms/send', {
      receptor: input.receptor,
      sender: input.sender || 'default',
    });
    log('sms/send receptor=%s sender=%s', input.receptor, input.sender || 'default');
    return this.post(input.apiKey, `/sms/send.json`, body);
  }

  private async post(apiKey: string, path: string, body: URLSearchParams): Promise<SmsResponse> {
    const url = `${KAVENEGAR_BASE}/${apiKey}${path}`;

    const response = await fetch(url, {
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });

    const raw = await response.text();
    let data: KavenegarApiResponse;
    try {
      data = JSON.parse(raw) as KavenegarApiResponse;
    } catch {
      throw new Error(`Kavenegar invalid JSON (HTTP ${response.status}): ${raw.slice(0, 200)}`);
    }

    if (!response.ok) {
      throw new Error(
        `Kavenegar HTTP ${response.status}: ${data.return?.message || raw.slice(0, 200)}`,
      );
    }

    const status = data.return?.status;
    if (status !== undefined && status !== 200) {
      throw new Error(`Kavenegar status ${status}: ${data.return?.message || 'unknown'}`);
    }

    console.info('[sms:kavenegar] sent', {
      messageId: extractMessageId(data.entries),
      status: data.return?.message,
    });

    return {
      messageId: extractMessageId(data.entries),
      provider: 'kavenegar',
    };
  }
}
