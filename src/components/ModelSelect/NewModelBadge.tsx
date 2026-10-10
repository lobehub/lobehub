import { Tag } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isNewReleaseDate } from '@/utils/time';

interface NewModelBadgeProps {
  label: string;
  releasedAt?: string;
}

/**
 * A pure badge component without i18n hooks.
 * Useful in large lists (e.g. dropdown menus) to avoid calling `useTranslation` for each row.
 */
export const NewModelBadge = memo<NewModelBadgeProps>(({ releasedAt, label }) => {
  if (!releasedAt || !isNewReleaseDate(releasedAt)) return null;

  return (
    <Tag color="blue" size="small">
      {label}
    </Tag>
  );
});

interface NewModelBadgeI18nProps {
  releasedAt?: string;
}

const NewModelBadgeI18n = memo<NewModelBadgeI18nProps>(({ releasedAt }) => {
  const { t } = useTranslation('common');

  return <NewModelBadge label={t('new')} releasedAt={releasedAt} />;
});

/**
 * Keep default export behavior for existing usages:
 * - Handles i18n via `useTranslation('common')`
 * - Renders nothing when the model is not a new release
 */
export default NewModelBadgeI18n;
