import {
  BRANDING_EMOJI,
  BRANDING_NAME,
  BRANDING_NAME_FA,
  ORG_NAME_FA,
} from '@lobechat/business-const';

/** Product name for Persian auth email copy / subjects. */
export const emailBrandName = BRANDING_NAME_FA || BRANDING_NAME;

/** Logo row for HTML auth emails (emoji + FA name + EN name when distinct). */
export const getEmailBrandLogoHtml = () => {
  const showEn = Boolean(BRANDING_NAME && BRANDING_NAME !== emailBrandName);
  const enSuffix = showEn
    ? `<span style="font-size: 14px; font-weight: 500; color: #6b7280; margin-left: 8px;">${BRANDING_NAME}</span>`
    : '';

  return `<div style="text-align: center; margin-bottom: 32px;">
      <div style="display: inline-flex; align-items: center; justify-content: center; background-color: #ffffff; border-radius: 12px; padding: 8px 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); direction: ltr;">
        <span style="font-size: 24px; line-height: 1; margin-right: 10px;">${BRANDING_EMOJI}</span>
        <span style="font-size: 18px; font-weight: 700; color: #000000; letter-spacing: -0.5px;">${emailBrandName}</span>${enSuffix}
      </div>
    </div>`;
};

/** Footer copyright line for HTML auth emails (Persian). */
export const getEmailBrandCopyrightHtml = () =>
  `© ${new Date().getFullYear()} ${ORG_NAME_FA}. تمامی حقوق محفوظ است.`;

/** Short automated-footer line, e.g. "این یک پیام خودکار از پاناچت است." */
export const getEmailBrandAutomatedMessage = () => `این یک پیام خودکار از ${emailBrandName} است.`;

/** Shared email body font stack with Persian-capable fallbacks. */
export const EMAIL_FONT_STACK = "Tahoma, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

/**
 * Format a duration in Persian for expiration notes.
 * Prefers hours when `seconds >= 3600`, otherwise minutes (or seconds if under a minute).
 */
export const formatEmailExpirationFa = (seconds: number) => {
  if (seconds >= 3600) {
    const hours = seconds / 3600;
    return hours === 1 ? '۱ ساعت' : `${hours} ساعت`;
  }

  if (seconds >= 60) {
    const minutes = Math.round(seconds / 60);
    return minutes === 1 ? '۱ دقیقه' : `${minutes} دقیقه`;
  }

  return seconds === 1 ? '۱ ثانیه' : `${seconds} ثانیه`;
};

/** Map workspace role keys to Persian labels for invite emails. */
export const formatWorkspaceRoleFa = (role: string) => {
  const normalized = role.trim().toLowerCase();
  const labels: Record<string, string> = {
    admin: 'مدیر',
    member: 'عضو',
    owner: 'مالک',
  };

  return labels[normalized] ?? role;
};
