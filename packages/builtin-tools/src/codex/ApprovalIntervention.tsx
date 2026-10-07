'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import { Flexbox } from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import { Button, SplitButton } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { CodexApprovalArguments, CodexApprovalDecision } from './approvalOptions';
import { getCodexApprovalDecisions, getCodexApprovalDecisionType } from './approvalOptions';
import FileChangeRender from './FileChangeRender';
import type { CodexFileChangeArgs, CodexFileChangeState } from './utils';

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;

    width: 100%;
  `,
  scope: css`
    margin: 0;
    font-size: 13px;
    overflow-wrap: anywhere;

    dd {
      margin-block: 0 8px;
      margin-inline: 0;
      white-space: pre-wrap;
    }
  `,
  hint: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const isDenyDecision = (decision: CodexApprovalDecision) => {
  const type = getCodexApprovalDecisionType(decision);
  if (type === 'cancel' || type === 'decline') return true;
  return (
    typeof decision !== 'string' &&
    'applyNetworkPolicyAmendment' in decision &&
    decision.applyNetworkPolicyAmendment.network_policy_amendment.action === 'deny'
  );
};

/**
 * Shows native approval context and submits the selected decision once.
 *
 * Use when:
 * - Codex requests permission for a command or file change.
 *
 * Expects:
 * - Native approval arguments and original tool input remain separate.
 *
 * Returns:
 * - The requested scope, file changes, and enabled native choices.
 */
export const CodexApprovalIntervention = ({
  actionsPortalTarget,
  apiName,
  args,
  disabled,
  messageId,
  onInteractionAction,
  pluginState,
  toolArgs,
}: BuiltinInterventionProps<CodexApprovalArguments, CodexFileChangeArgs, CodexFileChangeState>) => {
  const { t } = useTranslation('plugin');
  const [submitting, setSubmitting] = useState<string>();
  const decisions = getCodexApprovalDecisions(apiName, args);

  const submit = async (decision: CodexApprovalDecision) => {
    if (!onInteractionAction || disabled || submitting) return;
    const decisionKey = JSON.stringify(decision);
    setSubmitting(decisionKey);
    try {
      await onInteractionAction({ payload: { decision }, type: 'submit' });
    } finally {
      setSubmitting(undefined);
    }
  };

  const getLabel = (decision: CodexApprovalDecision) => {
    const type = getCodexApprovalDecisionType(decision);
    if (type === 'accept') return t('builtins.codex.approval.accept');
    if (type === 'acceptForSession') {
      if (apiName === 'file_change') return t('builtins.codex.approval.acceptFilesForSession');
      if (args.networkApprovalContext) {
        return t('builtins.codex.approval.allowHostForSession');
      }
      return t('builtins.codex.approval.acceptForSession');
    }
    if (typeof decision !== 'string' && 'acceptWithExecpolicyAmendment' in decision) {
      return t('builtins.codex.approval.acceptSimilarCommands', {
        command: JSON.stringify(decision.acceptWithExecpolicyAmendment.execpolicy_amendment),
      });
    }
    if (typeof decision !== 'string' && 'applyNetworkPolicyAmendment' in decision) {
      const policy = decision.applyNetworkPolicyAmendment.network_policy_amendment;
      return policy.action === 'allow'
        ? t('builtins.codex.approval.allowHost', { host: policy.host })
        : t('builtins.codex.approval.denyHost', { host: policy.host });
    }
    return t('builtins.codex.approval.deny');
  };

  const denyDecisions = decisions.filter(isDenyDecision);
  const allowDecisions = decisions.filter((decision) => !isDenyDecision(decision));
  const [primaryDecision, ...alternativeDecisions] = allowDecisions;
  const alternativeItems: DropdownItem[] = alternativeDecisions.map((decision) => ({
    key: JSON.stringify(decision),
    label: getLabel(decision),
    onClick: () => void submit(decision),
  }));
  const isSubmittingAllowDecision = allowDecisions.some(
    (decision) => JSON.stringify(decision) === submitting,
  );

  const actions = (
    <div className={styles.actions}>
      {denyDecisions.map((decision) => {
        const decisionKey = JSON.stringify(decision);
        return (
          <Button
            disabled={disabled || Boolean(submitting)}
            key={decisionKey}
            loading={submitting === decisionKey}
            size="small"
            type="text"
            onClick={() => void submit(decision)}
          >
            {getLabel(decision)}
          </Button>
        );
      })}
      {primaryDecision &&
        (alternativeItems.length > 0 ? (
          <SplitButton
            disabled={disabled || Boolean(submitting)}
            loading={isSubmittingAllowDecision}
            size="small"
            type="primary"
          >
            <SplitButton.Main onClick={() => void submit(primaryDecision)}>
              {getLabel(primaryDecision)}
            </SplitButton.Main>
            <SplitButton.Menu items={alternativeItems} />
          </SplitButton>
        ) : (
          <Button
            disabled={disabled || Boolean(submitting)}
            loading={submitting === JSON.stringify(primaryDecision)}
            size="small"
            type="primary"
            onClick={() => void submit(primaryDecision)}
          >
            {getLabel(primaryDecision)}
          </Button>
        ))}
    </div>
  );

  const network = isRecord(args.networkApprovalContext) ? args.networkApprovalContext : undefined;
  const prefix = Array.isArray(args.proposedExecpolicyAmendment)
    ? args.proposedExecpolicyAmendment.filter((part): part is string => typeof part === 'string')
    : undefined;

  return (
    <Flexbox gap={8}>
      <div className={styles.hint}>{args.reason || t('builtins.codex.approval.hint')}</div>
      <dl className={styles.scope}>
        {args.command && (
          <>
            <dt>{t('builtins.codex.approval.command')}</dt>
            <dd>
              <code>{args.command}</code>
            </dd>
          </>
        )}
        {args.cwd && (
          <>
            <dt>{t('builtins.codex.approval.cwd')}</dt>
            <dd>
              <code>{args.cwd}</code>
            </dd>
          </>
        )}
        {typeof network?.host === 'string' && (
          <>
            <dt>{t('builtins.codex.approval.network')}</dt>
            <dd>
              <code>
                {network.host}
                {typeof network.protocol === 'string' ? ` (${network.protocol})` : ''}
              </code>
            </dd>
          </>
        )}
        {prefix?.length ? (
          <>
            <dt>{t('builtins.codex.approval.commandPrefix')}</dt>
            <dd>
              <code>{JSON.stringify(prefix)}</code>
            </dd>
          </>
        ) : null}
        {args.grantRoot && (
          <>
            <dt>{t('builtins.codex.approval.grantRoot')}</dt>
            <dd>
              <code>{args.grantRoot}</code>
            </dd>
          </>
        )}
      </dl>
      {apiName === 'file_change' && (toolArgs || pluginState) && (
        <FileChangeRender
          args={toolArgs ?? {}}
          content={null}
          messageId={messageId}
          pluginState={pluginState}
        />
      )}
      {actionsPortalTarget ? createPortal(actions, actionsPortalTarget) : actions}
    </Flexbox>
  );
};
