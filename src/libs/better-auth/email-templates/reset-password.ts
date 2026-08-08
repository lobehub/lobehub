import { getEmailSupportHtml, getEmailSupportText } from '@/libs/email/support';

import {
  EMAIL_FONT_STACK,
  emailBrandName,
  getEmailBrandCopyrightHtml,
  getEmailBrandLogoHtml,
} from './branding';

/**
 * Password reset email template (Persian)
 * Sent to users when they request a password reset
 */
export const getResetPasswordEmailTemplate = (params: { url: string }) => {
  const { url } = params;

  return {
    html: `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>بازنشانی رمز عبور</title>
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
          بازنشانی رمز عبور
        </h1>
        <p style="color: #6b7280; font-size: 16px; margin: 0; line-height: 1.8;">
          نگران نباشید؛ کمکتان می‌کنیم دوباره وارد شوید.
        </p>
      </div>

      <!-- Content -->
      <div style="color: #374151; font-size: 16px; line-height: 1.8;">
        <p style="margin: 0 0 24px 0; text-align: center;">
          اخیراً درخواست بازنشانی رمز عبور حساب ${emailBrandName} خود را ثبت کرده‌اید. برای ادامه روی دکمه زیر کلیک کنید.
        </p>

        <!-- Button -->
        <div style="text-align: center; margin: 32px 0;">
          <a href="${url}" target="_blank"
             style="display: inline-block; background-color: #000000; color: #ffffff; text-decoration: none; padding: 16px 36px; border-radius: 14px; font-weight: 600; font-size: 16px; transition: all 0.2s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
            بازنشانی رمز عبور
          </a>
        </div>

        <!-- Security Note -->
        <div style="background-color: #f9fafb; border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px solid #f3f4f6;">
          <p style="color: #6b7280; font-size: 13px; margin: 0; text-align: center; line-height: 1.8;">
            🔒 اگر این درخواست را نداده‌اید، این ایمیل را نادیده بگیرید یا در صورت نگرانی با پشتیبانی تماس بگیرید.
          </p>
        </div>
      </div>

      <!-- Divider -->
      <div style="border-top: 1px solid #e5e7eb; margin: 32px 0;"></div>

      <!-- Fallback Link -->
      <div style="text-align: center;">
        <p style="color: #9ca3af; font-size: 13px; margin: 0 0 8px 0;">
          دکمه کار نمی‌کند؟ این آدرس را در مرورگر کپی کنید:
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
    subject: `بازنشانی رمز عبور — ${emailBrandName}`,
    text: `برای بازنشانی رمز عبور روی این لینک کلیک کنید: ${url}\n\n${getEmailSupportText()}`,
  };
};
