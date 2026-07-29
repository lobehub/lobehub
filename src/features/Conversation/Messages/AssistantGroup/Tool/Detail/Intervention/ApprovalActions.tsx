import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { CornerDownLeft } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';

import { useConversationResourceAccess } from '../../../../../hooks/useConversationResourceAccess';
import { useConversationStore } from '../../../../../store';
import { type ApprovalMode } from './index';

interface ApprovalActionsProps {
  apiName: string;
  approvalMode: ApprovalMode;
  assistantGroupId?: string;
  identifier: string;
  messageId: string;
  /**
   * Callback to be called before approve action
   * Used to flush pending saves (e.g., debounced saves) from intervention components
   */
  onBeforeApprove?: () => void | Promise<void>;
  toolCallId: string;
}

type Choice = 'approve' | 'approve-remember' | 'reject';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    width: 100%;
  `,
  footer: css`
    display: flex;
    justify-content: flex-end;
    margin-block-start: 8px;
  `,
  number: css`
    flex-shrink: 0;
    width: 18px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  option: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    min-height: 40px;
    padding-block: 7px;
    padding-inline: 16px;
    border-radius: calc(${cssVar.borderRadiusLG} - 2px);

    color: ${cssVar.colorTextSecondary};

    transition:
      background 120ms,
      color 120ms;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  optionLabel: css`
    flex: 1;
    line-height: 1.4;
  `,
  optionList: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  optionSelected: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  rejectInput: css`
    flex: 1;

    width: 100%;
    padding: 0;
    border: none;
    border-radius: 0;

    font-family: inherit;
    font-size: 14px;
    line-height: 1.4;
    color: ${cssVar.colorText};

    background: transparent;

    &::placeholder {
      color: ${cssVar.colorTextSecondary};
    }

    &:focus,
    &:focus-visible {
      outline: none;
    }

    &:disabled {
      cursor: pointer;
      color: ${cssVar.colorTextSecondary};
    }
  `,
  shortcutHint: css`
    display: inline-flex;
    align-items: center;
    margin-inline-start: 6px;
    color: ${cssVar.colorTextTertiary};
  `,
  submitButton: css`
    min-width: 88px;
    height: 36px;
    border-radius: calc(${cssVar.borderRadiusLG} - 2px);
  `,
}));

const ApprovalActions = memo<ApprovalActionsProps>(
  ({ approvalMode, apiName, assistantGroupId, identifier, messageId, onBeforeApprove }) => {
    const { t } = useTranslation('chat');
    const [choice, setChoice] = useState<Choice>('approve');
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);
    const rejectInputRef = useRef<HTMLInputElement>(null);

    const isMessageCreating = messageId.startsWith('tmp_');
    const isAllowListMode = approvalMode === 'allow-list';
    // Workspace topics are shared: a view-only member can be LOOKING at a
    // teammate's running conversation — they must not drive its tool approvals.
    const { canUseResource } = useConversationResourceAccess();

    // Ordered choices drive both the numbered rows and the 1/2/3 shortcuts.
    // "Approve & don't ask again" is a first-class option (allow-list only)
    // rather than a checkbox nested under approve.
    const choices = useMemo<Choice[]>(
      () => (isAllowListMode ? ['approve', 'approve-remember', 'reject'] : ['approve', 'reject']),
      [isAllowListMode],
    );

    const [approveToolCall, rejectAndContinueToolCall] = useConversationStore((s) => [
      s.approveToolCall,
      s.rejectAndContinueToolCall,
    ]);
    const addToolToAllowList = useUserStore((s) => s.addToolToAllowList);

    const handleSubmit = useCallback(async () => {
      if (loading || isMessageCreating || !canUseResource) return;
      setLoading(true);
      try {
        if (choice === 'reject') {
          await rejectAndContinueToolCall(messageId, reason.trim() || undefined);
        } else {
          if (onBeforeApprove) await onBeforeApprove();
          await approveToolCall(messageId, assistantGroupId ?? '');
          if (isAllowListMode && choice === 'approve-remember') {
            await addToolToAllowList(`${identifier}/${apiName}`);
          }
        }
      } finally {
        setLoading(false);
      }
    }, [
      addToolToAllowList,
      apiName,
      approveToolCall,
      assistantGroupId,
      canUseResource,
      choice,
      identifier,
      isAllowListMode,
      isMessageCreating,
      loading,
      messageId,
      onBeforeApprove,
      reason,
      rejectAndContinueToolCall,
    ]);

    // When choice flips to reject (via click on row, '2', or arrow), pull focus
    // into the inline input so the user can start typing the reason immediately.
    useEffect(() => {
      if (choice === 'reject') {
        rejectInputRef.current?.focus();
      }
    }, [choice]);

    // Window-level keyboard: 1/2/↑/↓ to switch, Enter to submit. Skip while
    // typing anywhere on the page so we never hijack the main chat composer.
    // The reject input has its own onKeyDown for Enter / ↑.
    useEffect(() => {
      if (!canUseResource) return;
      const handler = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null;
        if (target) {
          const tag = target.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
        }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        // Digit keys select the matching numbered row directly.
        if (/^[1-9]$/.test(e.key)) {
          const next = choices[Number(e.key) - 1];
          if (next) {
            e.preventDefault();
            setChoice(next);
          }
          return;
        }
        switch (e.key) {
          case 'ArrowUp':
          case 'ArrowDown': {
            e.preventDefault();
            setChoice((c) => {
              const idx = choices.indexOf(c);
              const delta = e.key === 'ArrowUp' ? -1 : 1;
              const nextIdx = (idx + delta + choices.length) % choices.length;
              return choices[nextIdx];
            });
            break;
          }
          case 'Enter': {
            if (e.shiftKey) return;
            e.preventDefault();
            void handleSubmit();
            break;
          }
          // No default
        }
      };
      window.addEventListener('keydown', handler);
      return () => {
        window.removeEventListener('keydown', handler);
      };
    }, [canUseResource, choices, handleSubmit]);

    const handleRejectInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = choices.indexOf('reject');
        const prev = choices[idx - 1];
        if (prev) setChoice(prev);
        rejectInputRef.current?.blur();
      }
    };

    const rejectNumber = choices.indexOf('reject') + 1;

    const approveLabel: Record<'approve' | 'approve-remember', string> = {
      'approve': t('tool.intervention.optionApprove'),
      'approve-remember': t('tool.intervention.optionApproveRemember'),
    };

    // View-only members see the pending intervention but get no approval
    // controls — the run belongs to a member who can use the agent.
    if (!canUseResource) return null;

    return (
      <Flexbox className={styles.container}>
        <div className={styles.optionList} role="radiogroup">
          {choices.map((c, index) => {
            if (c === 'reject') {
              return (
                <div
                  aria-checked={choice === 'reject'}
                  className={cx(styles.option, choice === 'reject' && styles.optionSelected)}
                  key={c}
                  role="radio"
                  onClick={() => {
                    setChoice('reject');
                    rejectInputRef.current?.focus();
                  }}
                >
                  <span className={styles.number}>{rejectNumber}.</span>
                  <input
                    aria-label={t('tool.intervention.rejectReasonPlaceholder')}
                    className={styles.rejectInput}
                    disabled={loading || isMessageCreating}
                    placeholder={t('tool.intervention.rejectReasonPlaceholder')}
                    ref={rejectInputRef}
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => setChoice('reject')}
                    onKeyDown={handleRejectInputKeyDown}
                  />
                </div>
              );
            }

            return (
              <div
                aria-checked={choice === c}
                className={cx(styles.option, choice === c && styles.optionSelected)}
                key={c}
                role="radio"
                onClick={() => setChoice(c)}
              >
                <span className={styles.number}>{index + 1}.</span>
                <span className={styles.optionLabel}>{approveLabel[c]}</span>
              </div>
            );
          })}
        </div>

        <div className={styles.footer}>
          <Button
            className={styles.submitButton}
            disabled={isMessageCreating}
            loading={loading}
            size={'middle'}
            type={'primary'}
            onClick={handleSubmit}
          >
            {t('tool.intervention.submit')}
            <span className={styles.shortcutHint}>
              <CornerDownLeft size={12} />
            </span>
          </Button>
        </div>
      </Flexbox>
    );
  },
);

export default ApprovalActions;
