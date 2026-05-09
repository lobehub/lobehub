import { Button, Flexbox } from '@lobehub/ui';
import { Checkbox } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { CornerDownLeft } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';

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

type Choice = 'approve' | 'reject';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    width: 100%;
  `,
  footer: css`
    display: flex;
    justify-content: flex-end;
    margin-block-start: 12px;
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

    padding-block: 8px;
    padding-inline: 12px;
    border-radius: 8px;

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
  rememberRow: css`
    margin-block: -2px 4px;
    padding-block: 4px;
    padding-inline-start: 42px;
  `,
  shortcutHint: css`
    display: inline-flex;
    align-items: center;
    margin-inline-start: 6px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const ApprovalActions = memo<ApprovalActionsProps>(
  ({ approvalMode, apiName, assistantGroupId, identifier, messageId, onBeforeApprove }) => {
    const { t } = useTranslation('chat');
    const [choice, setChoice] = useState<Choice>('approve');
    const [remember, setRemember] = useState(false);
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);
    const rejectInputRef = useRef<HTMLInputElement>(null);

    const isMessageCreating = messageId.startsWith('tmp_');
    const isAllowListMode = approvalMode === 'allow-list';

    const [approveToolCall, rejectAndContinueToolCall] = useConversationStore((s) => [
      s.approveToolCall,
      s.rejectAndContinueToolCall,
    ]);
    const addToolToAllowList = useUserStore((s) => s.addToolToAllowList);

    const handleSubmit = useCallback(async () => {
      if (loading || isMessageCreating) return;
      setLoading(true);
      try {
        if (choice === 'approve') {
          if (onBeforeApprove) await onBeforeApprove();
          await approveToolCall(messageId, assistantGroupId ?? '');
          if (isAllowListMode && remember) {
            await addToolToAllowList(`${identifier}/${apiName}`);
          }
        } else {
          await rejectAndContinueToolCall(messageId, reason.trim() || undefined);
        }
      } finally {
        setLoading(false);
      }
    }, [
      addToolToAllowList,
      apiName,
      approveToolCall,
      assistantGroupId,
      choice,
      identifier,
      isAllowListMode,
      isMessageCreating,
      loading,
      messageId,
      onBeforeApprove,
      reason,
      rejectAndContinueToolCall,
      remember,
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
      const handler = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null;
        if (target) {
          const tag = target.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
        }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        switch (e.key) {
          case '1': {
            e.preventDefault();
            setChoice('approve');
            break;
          }
          case '2': {
            e.preventDefault();
            setChoice('reject');
            break;
          }
          case 'ArrowUp':
          case 'ArrowDown': {
            e.preventDefault();
            setChoice((c) => (c === 'approve' ? 'reject' : 'approve'));
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
    }, [handleSubmit]);

    const handleRejectInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setChoice('approve');
        rejectInputRef.current?.blur();
      }
    };

    return (
      <Flexbox className={styles.container}>
        <div className={styles.optionList} role="radiogroup">
          <div
            aria-checked={choice === 'approve'}
            className={cx(styles.option, choice === 'approve' && styles.optionSelected)}
            role="radio"
            onClick={() => setChoice('approve')}
          >
            <span className={styles.number}>1.</span>
            <span className={styles.optionLabel}>{t('tool.intervention.optionApprove')}</span>
          </div>

          {isAllowListMode && choice === 'approve' && (
            <div className={styles.rememberRow}>
              <Checkbox
                checked={remember}
                disabled={loading || isMessageCreating}
                onChange={(e) => setRemember(e.target.checked)}
              >
                {t('tool.intervention.rememberSimilar')}
              </Checkbox>
            </div>
          )}

          <div
            aria-checked={choice === 'reject'}
            className={cx(styles.option, choice === 'reject' && styles.optionSelected)}
            role="radio"
            onClick={() => {
              setChoice('reject');
              rejectInputRef.current?.focus();
            }}
          >
            <span className={styles.number}>2.</span>
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
        </div>

        <div className={styles.footer}>
          <Button
            disabled={isMessageCreating}
            loading={loading}
            shape={'round'}
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
