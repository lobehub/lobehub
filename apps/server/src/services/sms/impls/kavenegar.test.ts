import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KavenegarSmsService, toKavenegarReceptor } from './kavenegar';

vi.mock('@/envs/sms', () => ({
  smsEnv: {
    AUTH_SMS_DEBUG_OTP: false,
    KAVENEGAR_API_KEY: undefined,
    KAVENEGAR_OTP_TEMPLATE: undefined,
    KAVENEGAR_SENDER: undefined,
  },
}));

describe('toKavenegarReceptor', () => {
  it('converts E.164 +98 to 09…', () => {
    expect(toKavenegarReceptor('+989121234567')).toBe('09121234567');
  });

  it('keeps local 09…', () => {
    expect(toKavenegarReceptor('09121234567')).toBe('09121234567');
  });

  it('prefixes bare 9…', () => {
    expect(toKavenegarReceptor('9121234567')).toBe('09121234567');
  });
});

describe('KavenegarSmsService', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    vi.stubEnv('KAVENEGAR_API_KEY', 'test-api-key');
    vi.stubEnv('KAVENEGAR_OTP_TEMPLATE', '');
    vi.stubEnv('KAVENEGAR_SENDER', '');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends OTP via verify/lookup when template is configured', async () => {
    vi.stubEnv('KAVENEGAR_OTP_TEMPLATE', 'verify');
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          entries: { messageid: 42 },
          return: { message: 'تایید شد', status: 200 },
        }),
    });

    const service = new KavenegarSmsService();
    const result = await service.sendSms({
      code: '123456',
      message: 'کد تایید شما: 123456',
      to: '+989121234567',
    });

    expect(result).toEqual({ messageId: '42', provider: 'kavenegar' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.kavenegar.com/v1/test-api-key/verify/lookup.json');
    expect(init.method).toBe('POST');
    const body = init.body as URLSearchParams;
    expect(body.get('receptor')).toBe('09121234567');
    expect(body.get('template')).toBe('verify');
    expect(body.get('token')).toBe('123456');
  });

  it('falls back to sms/send when no OTP template is set', async () => {
    vi.stubEnv('KAVENEGAR_SENDER', '10004346');
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          entries: [{ messageid: 99 }],
          return: { message: 'تایید شد', status: 200 },
        }),
    });

    const service = new KavenegarSmsService();
    const result = await service.sendSms({
      code: '654321',
      message: 'کد تایید شما: 654321',
      to: '09121234567',
    });

    expect(result.messageId).toBe('99');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.kavenegar.com/v1/test-api-key/sms/send.json');
    const body = init.body as URLSearchParams;
    expect(body.get('message')).toBe('کد تایید شما: 654321');
    expect(body.get('sender')).toBe('10004346');
  });

  it('throws on Kavenegar business status != 200', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          entries: null,
          return: { message: 'اعتبار حساب شما کافی نیست', status: 418 },
        }),
    });

    const service = new KavenegarSmsService();
    await expect(service.sendSms({ message: 'hi', to: '09121234567' })).rejects.toThrow(/418/);
  });
});
