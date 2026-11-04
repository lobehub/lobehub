import { isInterestAreaKey } from '@lobechat/const';
import type { TFunction } from 'i18next';

/**
 * The opening prompt queued into the composer by "Start a chat": predefined
 * interests read as their localized labels, freeform entries as typed.
 */
export const buildKickoffPrompt = (
  interests: string[],
  t: TFunction<'onboarding'>,
  locale?: string,
): string => {
  const labels = interests
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => (isInterestAreaKey(raw) ? t(`interests.area.${raw}`) : raw));

  if (labels.length === 0) return t('taskKickoff.prompt.default');

  const list = new Intl.ListFormat(locale, { type: 'conjunction' }).format(labels);
  return t('taskKickoff.prompt.withInterests', { interests: list });
};
