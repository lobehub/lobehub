import { getEmailSupportHtml, getEmailSupportText } from '@/libs/email/support';

import {
  EMAIL_FONT_STACK,
  emailBrandName,
  formatWorkspaceRoleFa,
  getEmailBrandLogoHtml,
} from './branding';

/**
 * Workspace invitation email template (Persian)
 * Sent when a workspace owner invites someone (by email) to join their workspace.
 */
export const getWorkspaceInviteEmailTemplate = (params: {
  expiresInDays: number;
  inviterEmail?: string | null;
  inviterName?: string | null;
  role: string;
  url: string;
  workspaceName: string;
}) => {
  const { url, workspaceName, inviterName, inviterEmail, role, expiresInDays } = params;

  const inviterLabel = inviterName || inviterEmail || 'یکی از هم‌تیمی‌ها';
  const inviterByline =
    inviterEmail && inviterName ? `${inviterName} (${inviterEmail})` : inviterLabel;
  const subject = `${inviterLabel} شما را به ${workspaceName} در ${emailBrandName} دعوت کرده است`;
  const roleLabel = formatWorkspaceRoleFa(role);
  const expiresDaysText = expiresInDays === 1 ? '۱ روز' : `${expiresInDays} روز`;

  return {
    html: `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: ${EMAIL_FONT_STACK}; background-color: #f4f4f5; color: #1a1a1a; direction: rtl;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">

    <!-- Logo -->
    ${getEmailBrandLogoHtml()}

    <!-- Card -->
    <div style="background: #ffffff; border-radius: 20px; padding: 40px; box-shadow: 0 8px 30px rgba(0,0,0,0.04); border: 1px solid rgba(0,0,0,0.02);">

      <!-- Header -->
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: #111827; font-size: 24px; font-weight: 700; margin: 0 0 12px 0; letter-spacing: -0.5px;">
          به <strong>${workspaceName}</strong> در ${emailBrandName} بپیوندید
        </h1>
        <p style="color: #6b7280; font-size: 16px; margin: 0;">
          شما با نقش <strong>${roleLabel}</strong> دعوت شده‌اید.
        </p>
      </div>

      <!-- Content -->
      <div style="color: #374151; font-size: 16px; line-height: 1.8;">
        <p style="margin: 0 0 24px 0;">
          <strong>${inviterByline}</strong> شما را برای همکاری در فضای کاری
          <strong>${workspaceName}</strong> در ${emailBrandName} دعوت کرده است.
        </p>

        <!-- Button -->
        <div style="text-align: center; margin: 36px 0;">
          <a href="${url}" target="_blank"
             style="display: inline-block; background-color: #000000; color: #ffffff; text-decoration: none; padding: 16px 36px; border-radius: 14px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
            پیوستن به تیم
          </a>
        </div>

        <!-- Expiration Note -->
        <div style="background-color: #fffbeb; border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px solid #fde68a;">
          <p style="color: #92400e; font-size: 14px; margin: 0; text-align: center;">
            ⏰ این دعوت‌نامه تا <strong>${expiresDaysText}</strong> دیگر منقضی می‌شود.
          </p>
        </div>

        <p style="color: #6b7280; font-size: 15px; margin: 0;">
          اگر هنوز حساب ${emailBrandName} ندارید، قبل از پیوستن به فضای کاری، مراحل کوتاه ثبت‌نام را طی خواهید کرد.
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
        اگر منتظر این دعوت نبودید، می‌توانید این ایمیل را نادیده بگیرید.
      </p>
    </div>
  </div>
</body>
</html>
    `,
    subject,
    text: `${inviterByline} شما را به فضای کاری «${workspaceName}» در ${emailBrandName} با نقش ${roleLabel} دعوت کرده است.\n\nپذیرش دعوت: ${url}\n\nاین دعوت‌نامه تا ${expiresDaysText} دیگر منقضی می‌شود.\n\nاگر منتظر این دعوت نبودید، می‌توانید این ایمیل را نادیده بگیرید.\n\n${getEmailSupportText()}`,
  };
};
