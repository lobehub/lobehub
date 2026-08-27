'use client';

import { SHARE_VISITOR_PROMPT_MAX_LENGTH } from '@lobechat/const';
import { ActionIcon, Flexbox, TextArea } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { CircleStop, SendHorizonal } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useIMECompositionEvent } from '@/hooks/useIMECompositionEvent';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import { shouldSubmitOnEnter } from './composerEnterGuard';
import { resolveVisitorErrorKey } from './resolveVisitorErrorKey';
import { useBudgetStatusRetry } from './useBudgetStatusRetry';
import { useShareRunStop } from './useShareRunStop';

interface VisitorComposerProps {
  agentId: string;
  /**
   * Copy key of a standing block (e.g. exhausted share budget). When set the
   * composer is disabled and the reason is shown persistently — sending would
   * only fail server-side anyway.
   */
  blockedKey?: string;
  /** Refresh the visitor topic list after a send created a new topic. */
  onTopicCreated?: (topicId: string) => void;
  shareId: string;
  topicId?: string | null;
}

/**
 * Lean visitor composer for shared agents. Intentionally NOT the owner
 * composer graph (see readOnlyImportBoundary.test.ts): no uploads (v1 rejects
 * them server-side anyway), no mentions, no device targets — just text in,
 * gateway-streamed answer out.
 */
const VisitorComposer = memo<VisitorComposerProps>(
  ({ agentId, blockedKey, onTopicCreated, shareId, topicId }) => {
    const { t } = useTranslation('agent');
    const [value, setValue] = useState('');
    const [errorKey, setErrorKey] = useState<string>();
    const [sending, setSending] = useState(false);
    const { checkingBlock, retryBlockedCheck, retryCheckError } = useBudgetStatusRetry(
      shareId,
      blockedKey,
    );
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
    const busy = sending || isStreaming;
    const displayedErrorKey = blockedKey ?? errorKey;

    const send = async () => {
      const message = value.trim();
      if (!message || busy || blockedKey) return;

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
          <Flexbox horizontal align="center" gap={8}>
            <span style={{ color: cssVar.colorError, fontSize: 12 }}>
              {t(displayedErrorKey as any, {
                // i18next's generated interpolation types default `{{max}}` to
                // `string` (no `{{max, number}}` format specifier), so pass a
                // string even though the source constant is numeric. Ignored
                // by every other error key (i18next drops unused options).
                max: String(SHARE_VISITOR_PROMPT_MAX_LENGTH),
              })}
            </span>
            {/* Once the retry check itself has failed, the AsyncError row below
              takes over the retry action so the visitor gets feedback specific
              to that failure instead of a silently-reset spinner. */}
            {blockedKey && !retryCheckError && (
              <Button
                loading={checkingBlock}
                size="small"
                type="text"
                onClick={() => void retryBlockedCheck()}
              >
                {t('share.visitor.errors.retry')}
              </Button>
            )}
          </Flexbox>
        )}
        {blockedKey && !!retryCheckError && (
          <AsyncError
            error={retryCheckError}
            retrying={checkingBlock}
            title={t('share.visitor.errors.retryCheckFailed')}
            variant="inline"
            onRetry={() => void retryBlockedCheck()}
          />
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
            disabled={!!blockedKey}
            // Mirrors `SHARE_VISITOR_PROMPT_MAX_LENGTH` (server-side real gate,
            // `apps/server/src/routers/lambda/shareChat.ts`) so a legitimate
            // long paste is capped up front instead of round-tripping to a
            // rejection. Convenience only — a direct RPC caller still hits the
            // server bound, handled by `resolveVisitorErrorKey`'s BAD_REQUEST
            // branch below.
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
              disabled={busy || !!blockedKey || !value.trim()}
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
