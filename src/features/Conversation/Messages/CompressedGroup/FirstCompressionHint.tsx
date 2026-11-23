import { Button, cssVar, Flexbox } from '@lobehub/ui';
import { X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import {
  dismissFirstCompression,
  isFirstCompressionDismissed,
  shouldShowFirstCompression,
  subscribeFirstCompression,
} from '@/utils/firstCompressionHint';

import { dataSelectors, useConversationStore } from '../../store';

export default function FirstCompressionHint({ id }: { id: string }) {
  const { t } = useTranslation(['chat', 'common']);
  const isFirstGroup = useConversationStore(
    (s) =>
      dataSelectors.displayMessages(s).find((message) => message.role === 'compressedGroup')?.id ===
      id,
  );
  const dismissed = useSyncExternalStore(
    subscribeFirstCompression,
    isFirstCompressionDismissed,
    () => true,
  );

  if (!shouldShowFirstCompression(dismissed, isFirstGroup)) return null;
  return (
    <Flexbox horizontal align={'center'} gap={4}>
      <span style={{ color: cssVar.colorTextDescription, fontSize: 12 }}>
        {t('compression.firstHint')}
      </span>
      <Button
        aria-label={t('common:close')}
        icon={X}
        size={'small'}
        type={'text'}
        onClick={dismissFirstCompression}
      />
    </Flexbox>
  );
}
