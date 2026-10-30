import { Tag, Tooltip } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isRoutingGroupId } from './isRoutingGroupId';

interface RoutingBadgeProps {
  /**
   * The model's id, `group/<id>` or `auto/<model>` for a magpie routing group.
   */
  id: string;
  /** The provider the row belongs to, which decides whether the id means that. */
  provider?: string;
}

/**
 * The tag a routing group's row carries, as the new-release badge does: a small
 * filled tag rather than wording in the name, since a name reads as one model
 * and a group is a pool of them.
 */
export const RoutingBadge = memo<RoutingBadgeProps>(({ id, provider }) => {
  const { t } = useTranslation('components');

  if (!isRoutingGroupId(id, provider)) return null;

  return (
    <Tooltip title={t('ModelSelect.routingTooltip')}>
      <Tag color={'blue'} size={'small'}>
        {t('ModelSelect.routing')}
      </Tag>
    </Tooltip>
  );
});

export default RoutingBadge;
