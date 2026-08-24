'use client';

import { ChatErrorType } from '@lobechat/types';
import { ActionIcon, Flexbox, TextArea } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { SendHorizonal } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

interface VisitorComposerProps {
  agentId: string;
  /** Refresh the visitor topic list after a send created a new topic. */
  onTopicCreated?: (topicId: string) => void;
  shareId: string;
  topicId?: string | null;
}

/** Map a share-run failure to the visitor-facing copy key. */
const resolveErrorKey = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(ChatErrorType.ShareTurnLimitExceeded))
    return 'share.visitor.errors.turnLimit';
  if (message.includes(ChatErrorType.ShareTopicLimitExceeded))
    return 'share.visitor.errors.topicLimit';
  if (message.includes(ChatErrorType.InsufficientBudgetForModel))
    return 'share.visitor.errors.insufficientBudget';
  return 'share.visitor.errors.generic';
};

/**
 * Lean visitor composer for shared agents. Intentionally NOT the owner
 * composer graph (see readOnlyImportBoundary.test.ts): no uploads (v1 rejects
 * them server-side anyway), no mentions, no device targets — just text in,
 * gateway-streamed answer out.
 */
const VisitorComposer = memo<VisitorComposerProps>(
  ({ agentId, onTopicCreated, shareId, topicId }) => {
    const { t } = useTranslation('agent');
    const [value, setValue] = useState('');
    const [errorKey, setErrorKey] = useState<string>();
    const [sending, setSending] = useState(false);

    const isStreaming = useChatStore(
      // messageMapKey ignores agentShareId — the running check keys off the
      // same main_<agentId>_<topicId> bucket the share run registers under.
      operationSelectors.isAgentRuntimeRunningByContext({
        agentId,
        scope: 'main',
        topicId,
      }),
    );
    const busy = sending || isStreaming;

    const send = async () => {
      const message = value.trim();
      if (!message || busy) return;

      setErrorKey(undefined);
      setSending(true);
      setValue('');
      try {
        const result = await useChatStore.getState().executeGatewayAgent({
          context: {
            agentId,
            agentShareId: shareId,
            scope: 'main',
            topicId: topicId ?? undefined,
          },
          message,
        });
        if (result.topicId && !topicId) onTopicCreated?.(result.topicId);
      } catch (error) {
        console.error('[AgentShareVisitor] send failed:', error);
        setErrorKey(resolveErrorKey(error));
        // Give the rejected input back so the visitor can retry / edit.
        setValue(message);
      } finally {
        setSending(false);
      }
    };

    return (
      <Flexbox gap={4} paddingBlock={8} paddingInline={12}>
        {errorKey && (
          <span style={{ color: cssVar.colorError, fontSize: 12 }}>{t(errorKey as any)}</span>
        )}
        <Flexbox
          horizontal
          align={'flex-end'}
          gap={8}
          style={{
            background: cssVar.colorFillQuaternary,
            border: `1px solid ${cssVar.colorBorderSecondary}`,
            borderRadius: 8,
            padding: 8,
          }}
        >
          <TextArea
            autoSize={{ maxRows: 6, minRows: 1 }}
            placeholder={t('share.visitor.input.placeholder')}
            style={{ border: 'none', boxShadow: 'none', padding: 0 }}
            value={value}
            variant={'borderless'}
            onChange={(e) => setValue(e.target.value)}
            onPressEnter={(e) => {
              if (e.shiftKey) return;
              e.preventDefault();
              void send();
            }}
          />
          <ActionIcon
            disabled={busy || !value.trim()}
            icon={SendHorizonal}
            loading={busy}
            title={t('share.visitor.input.send')}
            onClick={() => void send()}
          />
        </Flexbox>
      </Flexbox>
    );
  },
);

VisitorComposer.displayName = 'ShareVisitorComposer';

export default VisitorComposer;
