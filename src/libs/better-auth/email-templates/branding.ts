import {
  BRANDING_EMOJI,
  BRANDING_NAME,
  BRANDING_NAME_FA,
  COPYRIGHT_FULL,
} from '@lobechat/business-const';

/** Product name for English auth email copy / subjects. */
export const emailBrandName = BRANDING_NAME;

/** Logo row for HTML auth emails (emoji + EN name + FA name when distinct). */
export const getEmailBrandLogoHtml = () => {
  const showFa = Boolean(BRANDING_NAME_FA && BRANDING_NAME_FA !== BRANDING_NAME);
  const faSuffix = showFa
    ? `<span style="font-size: 14px; font-weight: 500; color: #6b7280; margin-left: 8px;">${BRANDING_NAME_FA}</span>`
    : '';

  return `<div style="text-align: center; margin-bottom: 32px;">
      <div style="display: inline-flex; align-items: center; justify-content: center; background-color: #ffffff; border-radius: 12px; padding: 8px 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
        <span style="font-size: 24px; line-height: 1; margin-right: 10px;">${BRANDING_EMOJI}</span>
        <span style="font-size: 18px; font-weight: 700; color: #000000; letter-spacing: -0.5px;">${BRANDING_NAME}</span>${faSuffix}
      </div>
    </div>`;
};

/** Footer copyright line for HTML auth emails. */
export const getEmailBrandCopyrightHtml = () => COPYRIGHT_FULL;

/** Short automated-footer line, e.g. "This is an automated message from Panachat." */
export const getEmailBrandAutomatedMessage = () =>
  `This is an automated message from ${BRANDING_NAME}.`;
