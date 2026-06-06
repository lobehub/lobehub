'use client';

import type { BuiltinPortalTitleProps } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { SlidersHorizontal } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Portal header for the lobe-agent delivery-check config. Owns its own name and
 * the focused-item `#N` badge so the framework title slot stays tool-agnostic.
 */
const PortalTitle = memo<BuiltinPortalTitleProps>(({ params }) => {
  const { t } = useTranslation('plugin');
  const index = params?.index;

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <Icon icon={SlidersHorizontal} size={16} />
      <Text style={{ fontSize: 16 }} type={'secondary'}>
        {t('builtins.lobe-agent.verifyPlan.portal.title')}
      </Text>
      {typeof index === 'number' && (
        <Text style={{ fontSize: 13 }} type={'secondary'}>
          #{index + 1}
        </Text>
      )}
    </Flexbox>
  );
});

PortalTitle.displayName = 'LobeAgentPortalTitle';

export default PortalTitle;
