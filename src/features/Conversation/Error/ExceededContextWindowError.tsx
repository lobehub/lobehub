import { Button, Icon } from '@lobehub/ui';
import { Minimize2 } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import { useConversationStore } from '../store';
import BaseErrorForm from './BaseErrorForm';
import { useRetryParentMessage } from './useRetryParentMessage';

/**
 * Copy for the failure that compaction recovers from. Both an over-long history and an
 * oversized request body (e.g. many large images inlined by the provider) shrink once the
 * history is summarized into text, so they share the compact-and-retry action.
 */
const COPY = {
  exceededContext: {
    desc: 'exceededContext.desc',
    title: 'exceededContext.title',
  },
  requestBodyTooLarge: {
    desc: 'requestBodyTooLarge.desc',
    title: 'requestBodyTooLarge.title',
  },
} as const;

interface ExceededContextWindowErrorProps {
  /**
   * Whether the user may write to this conversation. Supplied by the error renderer so the
   * card shares its retry gate (workspace permission plus `use` access to the agent or group);
   * the compression route rejects anyone else.
   */
  canCompact: boolean;
  id: string;
  /** Parent user message of an assistant group, whose `id` is a nested content block. */
  parentId?: string;
  reason?: keyof typeof COPY;
}

const ExceededContextWindowError = memo<ExceededContextWindowErrorProps>(
  ({ canCompact, id, parentId: groupParentId, reason = 'exceededContext' }) => {
    const { t } = useTranslation('error');

    const context = useConversationStore((s) => s.context);
    const { disabled, loading, parentId, retryParentMessage } = useRetryParentMessage(
      id,
      groupParentId,
    );

    const handleCompact = useCallback(async () => {
      if (!canCompact || !context.topicId) return;

      // Leave the failed turn out of the summary so it can be regenerated afterwards. A failed
      // compaction keeps the original history, so retrying would hit the same error again.
      // The failure toast's Retry reruns this whole flow, not only the compaction: once a bare
      // compaction succeeds, compacting again from this card finds nothing to summarize and
      // would skip the regeneration.
      const compactAndRetry = (): Promise<void> =>
        retryParentMessage(() =>
          useChatStore.getState().executeCompression(context, '', {
            beforeMessageId: parentId,
            onRetry: () => void compactAndRetry(),
          }),
        );

      await compactAndRetry();
    }, [canCompact, context, parentId, retryParentMessage]);

    return (
      <BaseErrorForm
        avatar={<Icon icon={Minimize2} size={24} />}
        desc={t(COPY[reason].desc)}
        title={t(COPY[reason].title)}
        action={
          <Button
            disabled={!canCompact || !context.topicId || disabled}
            loading={loading}
            type={'primary'}
            onClick={handleCompact}
          >
            {t('exceededContext.compact')}
          </Button>
        }
      />
    );
  },
);

export default ExceededContextWindowError;
