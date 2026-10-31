'use client';

import { cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { Check } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * "Met" for a metric clause: a quiet check and word in the success color.
 * A filled tag outweighed the number it qualifies.
 */
const MetBadge = memo(() => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox
      horizontal
      align={'center'}
      gap={3}
      style={{ color: cssVar.colorSuccess, flex: 'none' }}
    >
      <Icon icon={Check} size={12} />
      <Text fontSize={12} style={{ color: 'inherit' }}>
        {t('goalProcess.northStar.met')}
      </Text>
    </Flexbox>
  );
});

MetBadge.displayName = 'NorthStarMetBadge';

export default MetBadge;
