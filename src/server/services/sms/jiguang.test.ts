import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JiguangSMSService } from './jiguang';

describe('JiguangSMSService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends templated verification SMS to Jiguang', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ msg_id: '123' }), { status: 200 }),
    );

    const service = new JiguangSMSService({
      appKey: 'app-key',
      codeParamName: 'code',
      masterSecret: 'master-secret',
      signId: 31418,
      templateId: 1,
    });

    await service.sendVerificationCode({ code: '123456', phoneNumber: '+8613800138000' });

    expect(fetch).toHaveBeenCalledWith(
      'https://api.sms.jpush.cn/v1/messages',
      expect.objectContaining({
        body: JSON.stringify({
          mobile: '13800138000',
          sign_id: 31418,
          temp_id: 1,
          temp_para: {
            code: '123456',
          },
        }),
        headers: expect.objectContaining({
          'Authorization': `Basic ${Buffer.from('app-key:master-secret').toString('base64')}`,
          'Content-Type': 'application/json',
        }),
        method: 'POST',
      }),
    );
  });

  it('throws when Jiguang returns an error response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 }),
    );

    const service = new JiguangSMSService({
      appKey: 'app-key',
      codeParamName: 'code',
      masterSecret: 'master-secret',
      signId: 31418,
      templateId: 1,
    });

    await expect(
      service.sendVerificationCode({ code: '123456', phoneNumber: '+8613800138000' }),
    ).rejects.toThrow('bad request');
  });
});
