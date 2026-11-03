import { registerPendingHotkeyCard } from '@lobechat/shared-tool-ui/pending-hotkeys';
import type { BuiltinRememberApproval, DynamicInterventionResolver } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import { Button, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleStop, CornerDownLeft } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { clientInterventionAudits } from '@/store/chat/slices/agentRun/actions/transports/client/interventionAudits';
import { useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';

import { useConversationResourceAccess } from '../../../../../hooks/useConversationResourceAccess';
import { useConversationStore } from '../../../../../store';
import {
  type ApprovalChoice,
  approveChoiceLabelKeys,
  canRememberViaAllowList,
  dynamicAuditType,
  getApprovalChoices,
  isChoiceSubmitBlocked,
  isCoveredByRemember,
  resolveRememberAction,
} from './approvalGate';
import { type ApprovalMode } from './index';
import { isSubmitShortcutBlockedByTarget } from './submitShortcutGuard';

/** The audit this client runs for a tool's dynamic approval, to re-check calls after a remember. */
const rememberAuditFor = (config: unknown) => {
  const type = dynamicAuditType(config);
  return type
    ? (clientInterventionAudits as Record<string, DynamicInterventionResolver>)[type]
    : undefined;
};

interface ApprovalActionsProps {
  apiName: string;
  approvalMode: ApprovalMode;
  /**
   * Hold the approve choices: the intervention cannot show what is being
   * approved yet (see `onApprovalBlockedChange`). Reject and stop stay enabled.
   */
  approveDisabled?: boolean;
  assistantGroupId?: string;
  identifier: string;
  messageId: string;
  /**
   * Callback to be called before approve action
   * Used to flush pending saves (e.g., debounced saves) from intervention components
   */
  onBeforeApprove?: () =>
    Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
  /** The tool's own "approve and remember" step, when its intervention defines "similar". */
  rememberOption?: BuiltinRememberApproval;
  /** The call's arguments: a call that must always ask cannot be remembered. */
  toolArgs?: Record<string, unknown>;
  toolCallId: string;
}

type Choice = ApprovalChoice;

const styles = stylex.create({
  container: {
    width: '100%',
  },
  footer: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBlockStart: '8px',
  },
  number: {
    flexShrink: 0,
    width: '18px',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextTertiary,
  },
  option: {
    cursor: 'pointer',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    minHeight: '40px',
    paddingBlock: '7px',
    paddingInline: '16px',
    borderRadius: `calc(${cssVar.borderRadiusLG} - 2px)`,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    transition: 'background 120ms, color 120ms',
  },
  optionLabel: {
    flex: '1',
    lineHeight: 1.4,
  },
  optionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  optionSelected: {
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  rejectInput: {
    'flex': '1',
    'width': '100%',
    'padding': '0',
    'borderStyle': 'none',
    'borderRadius': '0',
    'fontFamily': 'inherit',
    'fontSize': '14px',
    'lineHeight': 1.4,
    'color': { 'default': cssVar.colorText, ':disabled': cssVar.colorTextSecondary },
    'backgroundColor': 'transparent',
    'backgroundImage': 'none',
    'outlineStyle': 'none',
    'cursor': { 'default': null, ':disabled': 'pointer' },
    '::placeholder': { color: cssVar.colorTextSecondary },
  },
  shortcutHint: {
    display: 'inline-flex',
    alignItems: 'center',
    marginInlineStart: '6px',
    color: cssVar.colorTextTertiary,
  },
  submitButton: {
    minWidth: '88px',
    height: '36px',
    borderRadius: `calc(${cssVar.borderRadiusLG} - 2px)`,
  },
});

const ApprovalActions = memo<ApprovalActionsProps>(
  ({
    approvalMode,
    approveDisabled,
    apiName,
    assistantGroupId,
    identifier,
    messageId,
    onBeforeApprove,
    rememberOption,
    toolArgs,
  }) => {
    const { t } = useTranslation(['chat', 'plugin']);
    const [choice, setChoice] = useState<Choice>('approve');
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);
    const rejectInputRef = useRef<HTMLInputElement>(null);

    const isMessageCreating = messageId.startsWith('tmp_');
    // Workspace topics are shared: a view-only member can be LOOKING at a
    // teammate's running conversation — they must not drive its tool approvals.
    const { canUseResource } = useConversationResourceAccess();

    // "Approve, and don't ask again for similar actions" is one shared choice
    // for every tool. A tool may define "similar" itself (its own remember
    // step); otherwise the tool joins the allow-list, which only helps when
    // this call is not one that must always ask.
    const interventionConfig = useToolStore(
      (s) =>
        toolSelectors
          .getManifestById(identifier)(s)
          ?.api?.find((api) => api.name === apiName)?.humanIntervention,
    );
    const allowListRememberable = useMemo(
      () => canRememberViaAllowList({ config: interventionConfig, toolArgs }),
      [interventionConfig, toolArgs],
    );
    const hasToolRemember = !!rememberOption;
    // Ordered choices drive both the numbered rows and the 1/2/3 shortcuts.
    const choices = useMemo<Choice[]>(
      () =>
        getApprovalChoices({
          allowListRememberable,
          approvalMode,
          toolRemember: hasToolRemember,
        }),
      [allowListRememberable, approvalMode, hasToolRemember],
    );
    // A tool's choice can be withdrawn while the card is open; fall back to plain approve.
    const effectiveChoice: Choice = choices.includes(choice) ? choice : 'approve';
    const rememberAction = resolveRememberAction({ toolRemember: hasToolRemember });

    const [
      approveToolCall,
      approveToolCallAndCovered,
      rejectAndContinueToolCall,
      stopPendingApprovalForCard,
    ] = useConversationStore((s) => [
      s.approveToolCall,
      s.approveToolCallAndCovered,
      s.rejectAndContinueToolCall,
      s.stopPendingApprovalForCard,
    ]);
    const [stopping, setStopping] = useState(false);

    /**
     * "Stop here — don't continue." Sits beside Submit because it answers the
     * same question the card is asking; splitting the two across the bar makes
     * the user hunt for the one they want.
     *
     * Not a rejection: rejecting writes a reason and lets the model respond,
     * stopping ends the turn outright and executes nothing.
     */
    const handleStop = useCallback(async () => {
      if (stopping || loading || isMessageCreating || !canUseResource) return;
      setStopping(true);
      try {
        await stopPendingApprovalForCard(messageId);
      } finally {
        setStopping(false);
      }
    }, [
      stopping,
      loading,
      isMessageCreating,
      canUseResource,
      stopPendingApprovalForCard,
      messageId,
    ]);
    const submitBlocked = isChoiceSubmitBlocked(effectiveChoice, approveDisabled);
    const handleSubmit = useCallback(async () => {
      if (loading || isMessageCreating || !canUseResource || submitBlocked) return;
      setLoading(true);
      try {
        if (effectiveChoice === 'reject') {
          await rejectAndContinueToolCall(messageId, reason.trim() || undefined);
        } else {
          const remember = effectiveChoice === 'approve-remember';
          // The tool's own remember step runs first, so the very next call
          // after this approval already sees it.
          if (remember && rememberAction === 'tool') await rememberOption?.onRemember();
          const editedArguments = await onBeforeApprove?.();
          if (remember) {
            const audit = rememberAuditFor(interventionConfig);
            await approveToolCallAndCovered(messageId, assistantGroupId ?? '', {
              editedArguments,
              isCovered: (sibling) =>
                isCoveredByRemember({
                  audit,
                  config: interventionConfig,
                  rememberAction,
                  toolArgs: safeParseJSON(sibling.requestArgs) ?? {},
                }),
              ...(rememberAction === 'allow-list'
                ? { rememberToolKey: `${identifier}/${apiName}` }
                : {}),
            });
          } else {
            await approveToolCall(messageId, assistantGroupId ?? '', { editedArguments });
          }
        }
      } finally {
        setLoading(false);
      }
    }, [
      apiName,
      approveToolCall,
      approveToolCallAndCovered,
      assistantGroupId,
      canUseResource,
      effectiveChoice,
      identifier,
      interventionConfig,
      isMessageCreating,
      loading,
      messageId,
      onBeforeApprove,
      reason,
      rejectAndContinueToolCall,
      rememberAction,
      rememberOption,
      submitBlocked,
    ]);

    // When choice flips to reject (via click on row, '2', or arrow), pull focus
    // into the inline input so the user can start typing the reason immediately.
    useEffect(() => {
      if (choice === 'reject') {
        rejectInputRef.current?.focus();
      }
    }, [choice]);

    // Page-level keyboard: 1/2/↑/↓ to switch, Enter to submit. Skip while
    // typing anywhere on the page so we never hijack the main chat composer,
    // and skip when another interactive control has focus — Enter must
    // activate that control, never silently submit an approval.
    // The reject input has its own onKeyDown for Enter / ↑.
    //
    // Kept fresh in a ref so the shared-arbiter registration below stays
    // mount-stable while the handler always sees current state.
    const containerRef = useRef<HTMLDivElement>(null);
    const onKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
    useEffect(() => {
      onKeyDownRef.current = (e: KeyboardEvent) => {
        if (e.defaultPrevented) return;
        if (isSubmitShortcutBlockedByTarget(e.target as HTMLElement | null)) return;
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
    }, [choices, handleSubmit]);

    // One registration per mount: the shared arbiter dispatches each keypress
    // to exactly one pending card (containment first, then newest
    // registration), so this card and a coexisting AskUserQuestion card (e.g.
    // in the global approval notification) never race on the same keystroke.
    useEffect(() => {
      if (!canUseResource) return;
      return registerPendingHotkeyCard({
        // The footer may be portaled away from the intervention body, so
        // containment covers the whole owning surface (marked with
        // `data-pending-hotkey-scope`: InterventionBar / global approval
        // card), falling back to the footer itself when rendered inline.
        contains: (node) => {
          const el = containerRef.current;
          if (!el) return false;
          return (el.closest('[data-pending-hotkey-scope]') ?? el).contains(node);
        },
        onKeyDown: (e) => onKeyDownRef.current(e),
      });
    }, [canUseResource]);

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

    const approveLabelFor = (c: 'approve' | 'approve-remember') => {
      const keys = approveChoiceLabelKeys({ apiName, choice: c, identifier });
      return t(keys.tool, { defaultValue: t(keys.shared), ns: 'plugin' });
    };

    // View-only members see the pending intervention but get no approval
    // controls — the run belongs to a member who can use the agent.
    if (!canUseResource) return null;

    return (
      <Flexbox className={stylex.props(styles.container).className} ref={containerRef}>
        <div {...stylex.props(styles.optionList)} role="radiogroup">
          {choices.map((c, index) => {
            if (c === 'reject') {
              return (
                <div
                  aria-checked={choice === 'reject'}
                  {...stylex.props(styles.option, choice === 'reject' && styles.optionSelected)}
                  key={c}
                  role="radio"
                  onClick={() => {
                    setChoice('reject');
                    rejectInputRef.current?.focus();
                  }}
                >
                  <span {...stylex.props(styles.number)}>{rejectNumber}.</span>
                  <input
                    aria-label={t('tool.intervention.rejectReasonPlaceholder')}
                    {...stylex.props(styles.rejectInput)}
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
                aria-checked={effectiveChoice === c}
                aria-disabled={approveDisabled || undefined}
                {...stylex.props(styles.option, effectiveChoice === c && styles.optionSelected)}
                key={c}
                role="radio"
                onClick={() => setChoice(c)}
              >
                <span className={stylex.props(styles.number).className}>{index + 1}.</span>
                <span className={stylex.props(styles.optionLabel).className}>
                  {approveLabelFor(c)}
                </span>
              </div>
            );
          })}
        </div>

        <div {...stylex.props(styles.footer)}>
          <Button
            disabled={loading || isMessageCreating}
            icon={CircleStop}
            loading={stopping}
            size={'middle'}
            type={'text'}
            onClick={handleStop}
          >
            {t('tool.intervention.stop')}
          </Button>
          <Button
            className={stylex.props(styles.submitButton).className}
            disabled={isMessageCreating || submitBlocked}
            loading={loading}
            size={'middle'}
            type={'primary'}
            onClick={handleSubmit}
          >
            {t('tool.intervention.submit')}
            <span {...stylex.props(styles.shortcutHint)}>
              <CornerDownLeft size={12} />
            </span>
          </Button>
        </div>
      </Flexbox>
    );
  },
);

export default ApprovalActions;
