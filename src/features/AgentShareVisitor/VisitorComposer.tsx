'use client';

import { SHARE_VISITOR_PROMPT_MAX_LENGTH } from '@lobechat/const';
import { Flexbox, TextArea } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { CircleStop, SendHorizonal } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useIMECompositionEvent } from '@/hooks/useIMECompositionEvent';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import { shouldSubmitOnEnter } from './composerEnterGuard';
import { isTerminalVisitorError, resolveVisitorErrorKey } from './resolveVisitorErrorKey';
import { sendVisitorMessage } from './sendVisitorMessage';
import { useShareRunStop } from './useShareRunStop';

interface VisitorComposerProps {
  agentId: string;
  /**
   * Copy key of a standing block (e.g. the share is no longer link-visible).
   * When set the composer is disabled and the reason is shown persistently —
   * sending would only fail server-side anyway.
   */
  blockedKey?: string;
  /** Refresh the visitor topic list after a send created a new topic. */
  onTopicCreated?: (topicId: string) => void;
  shareId: string;
  topicId?: string | null;
}

/**
 * Lean visitor composer for shared agents. Intentionally NOT the owner
 * composer graph: no uploads (v1 rejects them server-side anyway), no
 * mentions, no model switcher, no device targets — just text in,
 * gateway-streamed answer out.
 */
const VisitorComposer = memo<VisitorComposerProps>(
  ({ agentId, blockedKey, onTopicCreated, shareId, topicId }) => {
    const { t } = useTranslation('agent');
    const [value, setValue] = useState('');
    const [errorKey, setErrorKey] = useState<string>();
    const [sending, setSending] = useState(false);
    const { stopError, stopping, stopSharedRun } = useShareRunStop(shareId, agentId, topicId);
    const { compositionProps, isComposingRef } = useIMECompositionEvent();

    const isStreaming = useChatStore(
      // messageMapKey ignores agentShareId — the running check keys off the
      // same main_<agentId>_<topicId> bucket the share run registers under.
      operationSelectors.isAgentRuntimeRunningByContext({
        agentId,
        scope: 'main',
        topicId,
      }),
    );
    // A per-attempt failure belongs to the topic it happened in — the turn-limit
    // copy even tells the visitor to start a new conversation, so it must not
    // follow them there. Share-level failures (paused / deleted) do survive:
    // they are true for every topic.
    useEffect(() => {
      setErrorKey((prev) => (prev && isTerminalVisitorError(prev) ? prev : undefined));
    }, [topicId]);

    const busy = sending || isStreaming;
    // A share that stopped accepting traffic mid-session blocks the composer the
    // same way an up-front `blockedKey` does, instead of letting the visitor
    // resend into a guaranteed rejection.
    const blocked =
      blockedKey ?? (errorKey && isTerminalVisitorError(errorKey) ? errorKey : undefined);
    const displayedErrorKey = blocked ?? errorKey;

    const send = async () => {
      const message = value.trim();
      if (!message || busy || blocked) return;

      setErrorKey(undefined);
      setSending(true);
      setValue('');
      try {
        const result = await sendVisitorMessage({ agentId, message, shareId, topicId });
        if (result.topicId && !topicId) onTopicCreated?.(result.topicId);
      } catch (error) {
        console.error('[AgentShareVisitor] send failed:', error);
        setErrorKey(resolveVisitorErrorKey(error));
        // Give the rejected input back so the visitor can retry / edit.
        setValue(message);
      } finally {
        setSending(false);
      }
    };

    return (
      <Flexbox gap={4} paddingBlock={8} paddingInline={12}>
        {displayedErrorKey && (
          <Text fontSize={12} type={'danger'}>
            {t(displayedErrorKey as any, {
              // i18next's generated interpolation types default `{{max}}` to
              // `string` (no `{{max, number}}` format specifier), so pass a
              // string even though the source constant is numeric. Ignored by
              // every other error key (i18next drops unused options).
              max: String(SHARE_VISITOR_PROMPT_MAX_LENGTH),
            })}
          </Text>
        )}
        {!!stopError && (
          <AsyncError
            error={stopError}
            retrying={stopping}
            title={t('share.visitor.errors.stopFailed')}
            variant="inline"
            onRetry={() => void stopSharedRun()}
          />
        )}
        <Flexbox
          horizontal
          // Center the single-line state (the textarea is shorter than the send
          // button, so the text would otherwise hug the bottom edge); once the
          // textarea grows it becomes the tallest child and the button pins to
          // the bottom via its own alignSelf.
          align={'center'}
          gap={8}
          style={{
            background: cssVar.colorFillQuaternary,
            border: `1px solid ${cssVar.colorBorderSecondary}`,
            borderRadius: 12,
            padding: '6px 6px 6px 12px',
          }}
        >
          <TextArea
            autoSize={{ maxRows: 6, minRows: 1 }}
            disabled={!!blocked}
            // Mirrors `SHARE_VISITOR_PROMPT_MAX_LENGTH` (the server-side gate in
            // `apps/server/src/routers/lambda/shareChat.ts`) so a legitimate
            // long paste is capped up front instead of round-tripping to a
            // rejection. Convenience only — a direct RPC caller still hits the
            // server bound, handled by `resolveVisitorErrorKey`.
            maxLength={SHARE_VISITOR_PROMPT_MAX_LENGTH}
            placeholder={t('share.visitor.input.placeholder')}
            style={{ border: 'none', boxShadow: 'none', padding: 0 }}
            value={value}
            variant={'borderless'}
            onChange={(e) => setValue(e.target.value)}
            {...compositionProps}
            onPressEnter={(e) => {
              if (!shouldSubmitOnEnter(e, isComposingRef.current)) return;
              e.preventDefault();
              void send();
            }}
          />
          {isStreaming || stopping ? (
            // A run is actually streaming (as opposed to `sending`, the brief
            // window before the server has even created the operation) — show
            // Stop instead of a plain spinner so a long or unwanted run can be
            // cut off before it keeps burning the creator's share budget.
            // `stopSharedRun` flips the operation's `isAborting` flag as soon as
            // the request goes out, which makes `isStreaming` go false before
            // the interrupt has actually resolved — keep showing Stop (loading)
            // through `stopping` so the button doesn't flicker back to Send.
            <ActionIcon
              disabled={stopping}
              icon={CircleStop}
              loading={stopping}
              style={{ alignSelf: 'flex-end' }}
              title={t('share.visitor.input.stop')}
              onClick={() => void stopSharedRun()}
            />
          ) : (
            <ActionIcon
              disabled={busy || !!blocked || !value.trim()}
              icon={SendHorizonal}
              loading={busy}
              style={{ alignSelf: 'flex-end' }}
              title={t('share.visitor.input.send')}
              onClick={() => void send()}
            />
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

VisitorComposer.displayName = 'ShareVisitorComposer';

export default VisitorComposer;
