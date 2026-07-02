'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { SlidersHorizontal } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, dbMessageSelectors } from '@/store/chat/selectors';

/**
 * Portal header for the lobe-agent delivery-check config. Owns its own name and
 * the focused-item `#N / total` badge; prev/next nav lives in the header's right
 * slot (see Actions) so the framework title slot stays tool-agnostic. Reads the
 * focused index from the portal store so it stays in sync while navigating.
 */
const PortalTitle = memo(() => {
  const { t } = useTranslation('plugin');
  const messageId = useChatStore(chatPortalSelectors.toolMessageId);
  const params = useChatStore(chatPortalSelectors.toolUIParams, isEqual);
  const message = useChatStore(dbMessageSelectors.getDbMessageById(messageId || ''), isEqual);

  const isRubricView = params?.view === 'rubric';
  const index = typeof params?.index === 'number' ? params.index : 0;
  const total = (message?.pluginState as { items?: unknown[] } | undefined)?.items?.length ?? 0;

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <Icon icon={SlidersHorizontal} size={16} />
      <Text style={{ fontSize: 16 }} type={'secondary'}>
        {isRubricView
          ? t('builtins.lobe-delivery-checker.verifyPlan.portal.rubric.title')
          : t('builtins.lobe-delivery-checker.verifyPlan.portal.title')}
      </Text>
      {!isRubricView && total > 0 && (
        <Text style={{ fontSize: 13 }} type={'secondary'}>
          #{index + 1}
          {total > 1 && ` / ${total}`}
        </Text>
      )}
    </Flexbox>
  );
});

PortalTitle.displayName = 'LobeDeliveryCheckerPortalTitle';

export default PortalTitle;
