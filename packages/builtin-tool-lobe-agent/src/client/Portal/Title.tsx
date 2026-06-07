'use client';

import type { BuiltinPortalTitleProps } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { SlidersHorizontal } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { dbMessageSelectors } from '@/store/chat/selectors';

/**
 * Portal header for the lobe-agent delivery-check config. Owns its own name and
 * the focused-item `#N / total` badge; prev/next nav lives in the header's right
 * slot (see Actions) so the framework title slot stays tool-agnostic.
 */
const PortalTitle = memo<BuiltinPortalTitleProps>(({ messageId, params }) => {
  const { t } = useTranslation('plugin');
  const message = useChatStore(dbMessageSelectors.getDbMessageById(messageId || ''));

  const index = typeof params?.index === 'number' ? params.index : 0;
  const total = (message?.pluginState as { items?: unknown[] } | undefined)?.items?.length ?? 0;

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <Icon icon={SlidersHorizontal} size={16} />
      <Text style={{ fontSize: 16 }} type={'secondary'}>
        {t('builtins.lobe-agent.verifyPlan.portal.title')}
      </Text>
      {total > 0 && (
        <Text style={{ fontSize: 13 }} type={'secondary'}>
          #{index + 1}
          {total > 1 && ` / ${total}`}
        </Text>
      )}
    </Flexbox>
  );
});

PortalTitle.displayName = 'LobeAgentPortalTitle';

export default PortalTitle;
