'use client';

import { SHARE_VISITOR_PROMPT_MAX_LENGTH } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import {
  type ActionKeys,
  type ChatInputFeature,
  ChatInputProvider,
  DesktopChatInput,
  type SendButtonHandler,
} from '@/features/ChatInput';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import { isTerminalVisitorError, resolveVisitorErrorKey } from './resolveVisitorErrorKey';
import { sendVisitorMessage } from './sendVisitorMessage';
import { useShareRunStop } from './useShareRunStop';

const styles = createStaticStyles(({ css }) => ({
  blocked: css`
    cursor: not-allowed;

    padding-block: 10px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
}));

/** Stable empty arrays: a fresh `[]` per render would re-sync the input store every time. */
const NO_ACTIONS: ActionKeys[] = [];

/**
 * Every editor feature the visitor must NOT get. All four keys are listed on
 * purpose: an omitted key defaults to ON inside `InputEditor`.
 *
 * - slash / mention: both resolve against the OWNER's skills, documents and
 *   group members, none of which a visitor can see or call.
 * - inputCompletion: an extra model call on the visitor's own account for a
 *   surface that is supposed to bill the creator only.
 * - inputHistory: with the blank agent id (see below) history would land in
 *   the visitor's shared "global" bucket and leak into their other composers.
 */
const VISITOR_FEATURE: ChatInputFeature = {
  inputCompletion: false,
  inputHistory: false,
  mention: false,
  slash: false,
};

const noop = () => {};

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
 * Lean visitor composer for shared agents: the product's rich editor
 * (markdown, Enter/Shift+Enter, IME, the user's own Enter-vs-Cmd+Enter
 * preference) without the owner composer graph — no uploads (v1 rejects them
 * server-side anyway), no mentions, no slash actions, no model switcher, no
 * device targets. Just text in, gateway-streamed answer out.
 *
 * The provider is mounted with `agentId=""` rather than the shared agent's id.
 * Several editor hooks treat a non-empty id as "an agent of mine" and fetch its
 * permissions, documents and agency config, which for a foreign agent is a
 * string of rejected requests. The blank id (not `undefined`, which falls back
 * to the visitor's active agent) turns every one of those lookups off; the
 * actual target of a send is the `agentId` prop, passed to
 * {@link sendVisitorMessage} directly.
 */
const VisitorComposer = memo<VisitorComposerProps>(
  ({ agentId, blockedKey, onTopicCreated, shareId, topicId }) => {
    const { t } = useTranslation('agent');
    const [errorKey, setErrorKey] = useState<string>();
    const [sending, setSending] = useState(false);
    const { stopError, stopping, stopSharedRun } = useShareRunStop(shareId, agentId, topicId);

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

    // `sendButtonProps.disabled` is read from the store, which lags a keystroke
    // behind the editor; the Enter handler asks this ref instead so a fast
    // "type → Enter" during a run cannot slip a second send through.
    const busyRef = useRef(busy);
    busyRef.current = busy;

    // The editor has no "text only" switch: a pasted image is uploaded to the
    // visitor's own storage and shown as an attachment chip that the share
    // transport would then silently drop. Swallow file pastes before the
    // editor's own paste plugin sees them — a NATIVE capture listener on the
    // wrapper, because Lexical listens natively on the contenteditable and
    // React's delegated `onPasteCapture` would run after it. Text pastes are
    // untouched. A callback ref (not an effect) because the wrapper only
    // exists while the composer is not blocked.
    const attachPasteGuard = useCallback((wrapper: HTMLDivElement | null) => {
      if (!wrapper) return;
      const swallowFilePaste = (event: ClipboardEvent) => {
        if (!event.clipboardData?.files.length) return;
        event.preventDefault();
        event.stopPropagation();
      };
      wrapper.addEventListener('paste', swallowFilePaste, true);
      return () => wrapper.removeEventListener('paste', swallowFilePaste, true);
    }, []);

    const send: SendButtonHandler = async ({ clearContent, editor, getMarkdownContent }) => {
      const message = getMarkdownContent().trim();
      if (!message || busyRef.current) return;

      // Mirrors `SHARE_VISITOR_PROMPT_MAX_LENGTH` (the server-side gate in
      // `apps/server/src/routers/lambda/shareChat.ts`) so a long paste is
      // rejected up front, with the text kept, instead of round-tripping.
      if (message.length > SHARE_VISITOR_PROMPT_MAX_LENGTH) {
        setErrorKey('share.visitor.errors.promptTooLong');
        return;
      }

      setErrorKey(undefined);
      setSending(true);
      clearContent();
      try {
        const result = await sendVisitorMessage({ agentId, message, shareId, topicId });
        if (result.topicId && !topicId) onTopicCreated?.(result.topicId);
      } catch (error) {
        console.error('[AgentShareVisitor] send failed:', error);
        setErrorKey(resolveVisitorErrorKey(error));
        // Give the rejected input back so the visitor can retry / edit.
        editor.setDocument('markdown', message);
      } finally {
        setSending(false);
      }
    };

    return (
      // Same centered column as `ChatList` (via `WideScreenContainer`), so the
      // composer's edges line up with the messages above it instead of
      // spanning the full pane on a wide window.
      <WideScreenContainer gap={4} paddingBlock={8}>
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
        {blocked ? (
          // The editor cannot be made read-only from the outside, and a live
          // editor under a "sharing paused" line invites typing into a dead
          // end — so the blocked state is a plain strip, not a disabled input.
          <Flexbox className={styles.blocked}>
            <Text type={'secondary'}>{t('share.visitor.input.placeholder')}</Text>
          </Flexbox>
        ) : (
          <div ref={attachPasteGuard}>
            <ChatInputProvider
              agentId=""
              allowExpand={false}
              feature={VISITOR_FEATURE}
              leftActions={NO_ACTIONS}
              resolveSendBlocked={() => busyRef.current}
              rightActions={NO_ACTIONS}
              sendButtonProps={{
                disabled: busy,
                // A run is actually streaming (as opposed to `sending`, the brief
                // window before the server has even created the operation) — show
                // Stop so a long or unwanted run can be cut off before it keeps
                // burning the creator's share budget. `stopSharedRun` flips the
                // operation's `isAborting` flag as soon as the request goes out,
                // which makes `isStreaming` go false before the interrupt has
                // resolved — keep Stop through `stopping` so it doesn't flicker.
                generating: isStreaming || stopping,
                onStop: () => void stopSharedRun(),
                shape: 'round',
              }}
              onSend={send}
            >
              <DesktopChatInput
                // `false`, not `undefined`: the slot falls back to the owner
                // action bar on `??`.
                leftContent={false}
                // A custom placeholder also skips the default one's
                // workspace-preference fetch.
                placeholder={t('share.visitor.input.placeholder')}
                showControlBar={false}
                inputContainerProps={{
                  minHeight: 36,
                  // The default handler stores the composer height in the global
                  // status the OWNER's composer reads back; a share page must
                  // not resize somebody else's input.
                  onSizeChange: noop,
                  resize: false,
                }}
              />
            </ChatInputProvider>
          </div>
        )}
      </WideScreenContainer>
    );
  },
);

VisitorComposer.displayName = 'ShareVisitorComposer';

export default VisitorComposer;
