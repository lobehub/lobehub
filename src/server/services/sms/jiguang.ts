import { toJiguangMobile } from '@/libs/auth/phone';

const JIGUANG_SMS_API_URL = 'https://api.sms.jpush.cn/v1/messages';

export interface JiguangSMSConfig {
  appKey: string;
  codeParamName?: string;
  masterSecret: string;
  signId?: number;
  templateId: number;
}

export interface SendVerificationCodeParams {
  code: string;
  phoneNumber: string;
}

export class JiguangSMSService {
  private readonly config: JiguangSMSConfig;

  constructor(config: JiguangSMSConfig) {
    this.config = config;
  }

  async sendVerificationCode({ code, phoneNumber }: SendVerificationCodeParams) {
    const mobile = toJiguangMobile(phoneNumber);

    if (!mobile) throw new Error('Invalid mainland China phone number');

    const response = await fetch(JIGUANG_SMS_API_URL, {
      body: JSON.stringify({
        mobile,
        ...(this.config.signId ? { sign_id: this.config.signId } : {}),
        temp_id: this.config.templateId,
        temp_para: {
          [this.config.codeParamName || 'code']: code,
        },
      }),
      headers: {
        'Authorization': `Basic ${Buffer.from(`${this.config.appKey}:${this.config.masterSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    if (response.ok) return;

    const data = await response.json().catch(() => null);
    const errorMessage = data?.error?.message || 'Failed to send verification SMS';

    throw new Error(errorMessage);
  }
}
