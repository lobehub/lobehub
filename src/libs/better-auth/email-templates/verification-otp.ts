import { getEmailSupportHtml, getEmailSupportText } from '@/libs/email/support';

import {
  EMAIL_FONT_STACK,
  emailBrandName,
  formatEmailExpirationFa,
  getEmailBrandCopyrightHtml,
  getEmailBrandLogoHtml,
} from './branding';

/**
 * Email OTP verification template for mobile (Persian)
 * Sent to users when they need to verify their email using OTP code
 */
export const getVerificationOTPEmailTemplate = (params: {
  expiresInSeconds: number;
  otp: string;
  userName?: string | null;
}) => {
  const { otp, userName, expiresInSeconds } = params;
  const expirationText = formatEmailExpirationFa(expiresInSeconds);

  return {
    html: `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تأیید ایمیل</title>
</head>
<body style="margin: 0; padding: 0; font-family: ${EMAIL_FONT_STACK}; background-color: #f4f4f5; color: #1a1a1a; direction: rtl;">
  <!-- Container -->
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">

    <!-- Logo -->
    ${getEmailBrandLogoHtml()}

    <!-- Card -->
    <div style="background: #ffffff; border-radius: 20px; padding: 40px; box-shadow: 0 8px 30px rgba(0,0,0,0.04); border: 1px solid rgba(0,0,0,0.02);">

      <!-- Header -->
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: #111827; font-size: 24px; font-weight: 700; margin: 0 0 12px 0; letter-spacing: -0.5px;">
          تأیید آدرس ایمیل
        </h1>
        <p style="color: #6b7280; font-size: 16px; margin: 0;">
          این کد را در اپلیکیشن وارد کنید تا تأیید کامل شود.
        </p>
      </div>

      <!-- Content -->
      <div style="color: #374151; font-size: 16px; line-height: 1.8;">
        ${userName ? `<p style="margin: 0 0 16px 0;">سلام <strong>${userName}</strong>،</p>` : ''}

        <p style="margin: 0 0 24px 0;">
          از ثبت‌نام در ${emailBrandName} سپاسگزاریم. برای تأیید ایمیل، از کد زیر استفاده کنید:
        </p>

        <!-- OTP Code Box -->
        <div style="text-align: center; margin: 36px 0;">
          <div style="display: inline-block; background-color: #000000; padding: 24px 48px; border-radius: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
            <div style="font-size: 36px; font-weight: 700; letter-spacing: 12px; color: #ffffff; font-family: 'Courier New', Courier, monospace; direction: ltr;">
              ${otp}
            </div>
          </div>
        </div>

        <!-- Expiration Note -->
        <div style="background-color: #f9fafb; border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px solid #f3f4f6;">
          <p style="color: #6b7280; font-size: 14px; margin: 0; text-align: center;">
            ⏰ این کد تا <strong>${expirationText}</strong> دیگر منقضی می‌شود.
          </p>
        </div>

        <p style="color: #6b7280; font-size: 15px; margin: 0 0 8px 0;">
          اگر این کد را درخواست نکرده‌اید، می‌توانید این ایمیل را نادیده بگیرید.
        </p>
      </div>

      <!-- Divider -->
      <div style="border-top: 1px solid #e5e7eb; margin: 32px 0;"></div>

      <!-- Security Note -->
      <div style="text-align: center;">
        <p style="color: #9ca3af; font-size: 13px; margin: 0 0 8px 0;">
          🔒 به‌خاطر امنیت، این کد را با کسی به اشتراک نگذارید.
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align: center; margin-top: 32px;">
      <p style="font-size: 13px; margin: 0 0 8px 0;">
        ${getEmailSupportHtml()}
      </p>
      <p style="color: #a1a1aa; font-size: 13px; margin: 0;">
        ${getEmailBrandCopyrightHtml()}
      </p>
    </div>
  </div>
</body>
</html>
    `,
    subject: `تأیید ایمیل — ${emailBrandName}`,
    text: `کد تأیید شما: ${otp}\n\nاین کد تا ${expirationText} دیگر منقضی می‌شود.\n\nاگر این کد را درخواست نکرده‌اید، می‌توانید این ایمیل را نادیده بگیرید.\n\n${getEmailSupportText()}`,
  };
};
