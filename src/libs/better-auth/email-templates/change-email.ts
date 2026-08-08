import { getEmailSupportHtml, getEmailSupportText } from '@/libs/email/support';

import {
  EMAIL_FONT_STACK,
  emailBrandName,
  formatEmailExpirationFa,
  getEmailBrandCopyrightHtml,
  getEmailBrandLogoHtml,
} from './branding';

/**
 * Change email verification template (Persian)
 * Sent to users when they request to change their email address
 */
export const getChangeEmailVerificationTemplate = (params: {
  expiresInSeconds: number;
  url: string;
  userName?: string | null;
}) => {
  const { url, userName, expiresInSeconds } = params;
  const expirationText = formatEmailExpirationFa(expiresInSeconds);

  return {
    html: `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تأیید ایمیل جدید</title>
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
          تأیید آدرس ایمیل جدید
        </h1>
        <p style="color: #6b7280; font-size: 16px; margin: 0;">
          درخواست تغییر ایمیل دریافت شد.
        </p>
      </div>

      <!-- Content -->
      <div style="color: #374151; font-size: 16px; line-height: 1.8;">
        ${userName ? `<p style="margin: 0 0 16px 0;">سلام <strong>${userName}</strong>،</p>` : ''}

        <p style="margin: 0 0 24px 0;">
          درخواستی برای تغییر ایمیل حساب ${emailBrandName} شما به این آدرس دریافت کردیم. لطفاً با کلیک روی دکمه زیر آن را تأیید کنید.
        </p>

        <!-- Button -->
        <div style="text-align: center; margin: 36px 0;">
          <a href="${url}" target="_blank"
             style="display: inline-block; background-color: #000000; color: #ffffff; text-decoration: none; padding: 16px 36px; border-radius: 14px; font-weight: 600; font-size: 16px; transition: transform 0.1s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
            تأیید ایمیل جدید
          </a>
        </div>

        <!-- Expiration Note -->
        <div style="background-color: #f9fafb; border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px solid #f3f4f6;">
          <p style="color: #6b7280; font-size: 14px; margin: 0; text-align: center;">
            ⏰ این لینک تا <strong>${expirationText}</strong> دیگر منقضی می‌شود.
          </p>
        </div>

        <p style="color: #6b7280; font-size: 15px; margin: 0 0 8px 0;">
          اگر این تغییر را درخواست نکرده‌اید، این ایمیل را نادیده بگیرید. ایمیل فعلی شما بدون تغییر می‌ماند.
        </p>
      </div>

      <!-- Divider -->
      <div style="border-top: 1px solid #e5e7eb; margin: 32px 0;"></div>

      <!-- Fallback Link -->
      <div style="text-align: center;">
        <p style="color: #9ca3af; font-size: 13px; margin: 0 0 8px 0;">
          دکمه کار نمی‌کند؟ این لینک را در مرورگر کپی کنید:
        </p>
        <a href="${url}" style="color: #2563eb; font-size: 13px; text-decoration: none; word-break: break-all; display: block; line-height: 1.4; direction: ltr;">
          ${url}
        </a>
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
    subject: `تأیید ایمیل جدید — ${emailBrandName}`,
    text: `درخواست تغییر ایمیل حساب ${emailBrandName} شما ثبت شد. لطفاً با کلیک روی این لینک تأیید کنید: ${url}\n\nاین لینک تا ${expirationText} دیگر منقضی می‌شود.\n\nاگر این تغییر را درخواست نکرده‌اید، این ایمیل را نادیده بگیرید.\n\n${getEmailSupportText()}`,
  };
};
