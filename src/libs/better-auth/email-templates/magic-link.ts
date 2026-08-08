import { getEmailSupportHtml, getEmailSupportText } from '@/libs/email/support';

import {
  EMAIL_FONT_STACK,
  emailBrandName,
  formatEmailExpirationFa,
  getEmailBrandCopyrightHtml,
  getEmailBrandLogoHtml,
} from './branding';

/**
 * Magic link sign-in email template (Persian)
 * Sent when user requests passwordless login
 */
export const getMagicLinkEmailTemplate = (params: { expiresInSeconds: number; url: string }) => {
  const { url, expiresInSeconds } = params;
  const expirationText = formatEmailExpirationFa(expiresInSeconds);

  return {
    html: `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ورود به ${emailBrandName}</title>
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
          ورود به ${emailBrandName}
        </h1>
        <p style="color: #6b7280; font-size: 16px; margin: 0; line-height: 1.8;">
          برای ورود به حساب، روی لینک زیر کلیک کنید.
        </p>
      </div>

      <!-- Content -->
      <div style="color: #374151; font-size: 16px; line-height: 1.8;">
        
        <!-- Button -->
        <div style="text-align: center; margin: 32px 0;">
          <a href="${url}" target="_blank"
             style="display: inline-block; background-color: #000000; color: #ffffff; text-decoration: none; padding: 16px 36px; border-radius: 14px; font-weight: 600; font-size: 16px; transition: all 0.2s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
            ورود
          </a>
        </div>

        <!-- Expiration Note -->
        <div style="background-color: #f9fafb; border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px solid #f3f4f6;">
          <p style="color: #6b7280; font-size: 13px; margin: 0; text-align: center; line-height: 1.8;">
            ⏰ این لینک تا <strong>${expirationText}</strong> دیگر منقضی می‌شود.
          </p>
        </div>

        <p style="color: #6b7280; font-size: 14px; margin: 0 0 8px 0; text-align: center;">
          اگر این ایمیل را درخواست نکرده‌اید، می‌توانید آن را نادیده بگیرید.
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
    subject: `لینک ورود به ${emailBrandName}`,
    text: `برای ورود از این لینک استفاده کنید: ${url}\n\nاین لینک تا ${expirationText} دیگر منقضی می‌شود.\n\n${getEmailSupportText()}`,
  };
};
