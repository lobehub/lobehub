import { getEmailSupportHtml, getEmailSupportText } from '@/libs/email/support';

import {
  EMAIL_FONT_STACK,
  emailBrandName,
  getEmailBrandAutomatedMessage,
  getEmailBrandLogoHtml,
} from './branding';

export const getWorkspaceMemberRemovedEmailTemplate = (params: {
  reason: 'downgrade' | 'removed_by_owner';
  workspaceName: string;
}) => {
  const { workspaceName, reason } = params;

  const isDowngrade = reason === 'downgrade';

  const subject = `شما از ${workspaceName} در ${emailBrandName} حذف شده‌اید`;

  const heading = `حذف از <strong>${workspaceName}</strong>`;

  const body = isDowngrade
    ? `فضای کاری <strong>${workspaceName}</strong> به نسخه پایین‌تر تغییر کرده و در نتیجه همه اعضای تیم حذف شده‌اند. داده‌ها و فضاهای کاری شخصی شما تحت تأثیر قرار نگرفته‌اند.`
    : `مالک فضای کاری <strong>${workspaceName}</strong> شما را از این فضا حذف کرده است. داده‌ها و فضاهای کاری شخصی شما تحت تأثیر قرار نگرفته‌اند.`;

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
          ${heading}
        </h1>
      </div>

      <!-- Content -->
      <div style="color: #374151; font-size: 16px; line-height: 1.8;">
        <p style="margin: 0 0 24px 0;">
          ${body}
        </p>

        <!-- Info Note -->
        <div style="background-color: #f0f9ff; border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px solid #bae6fd;">
          <p style="color: #0c4a6e; font-size: 14px; margin: 0; text-align: center;">
            اگر فکر می‌کنید اشتباهی رخ داده، با مالک فضای کاری تماس بگیرید.
          </p>
        </div>
      </div>

      <!-- Divider -->
      <div style="border-top: 1px solid #e5e7eb; margin: 32px 0;"></div>

      <!-- Footer note -->
      <div style="text-align: center;">
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">
          می‌توانید با فضای کاری شخصی خود به استفاده از ${emailBrandName} ادامه دهید.
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align: center; margin-top: 32px;">
      <p style="font-size: 13px; margin: 0 0 8px 0;">
        ${getEmailSupportHtml()}
      </p>
      <p style="color: #a1a1aa; font-size: 13px; margin: 0;">
        ${getEmailBrandAutomatedMessage()}
      </p>
    </div>
  </div>
</body>
</html>
    `,
    subject,
    text: isDowngrade
      ? `فضای کاری «${workspaceName}» به نسخه پایین‌تر تغییر کرده و در نتیجه همه اعضای تیم حذف شده‌اند. داده‌ها و فضاهای کاری شخصی شما تحت تأثیر قرار نگرفته‌اند. اگر فکر می‌کنید اشتباهی رخ داده، با مالک فضای کاری تماس بگیرید.\n\n${getEmailSupportText()}`
      : `مالک فضای کاری «${workspaceName}» شما را از این فضا حذف کرده است. داده‌ها و فضاهای کاری شخصی شما تحت تأثیر قرار نگرفته‌اند. اگر فکر می‌کنید اشتباهی رخ داده، با مالک فضای کاری تماس بگیرید.\n\n${getEmailSupportText()}`,
  };
};
