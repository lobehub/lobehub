'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import { Button, SplitButton } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { CodexApprovalArguments, CodexApprovalDecision } from './approvalOptions';
import { getCodexApprovalDecisions, getCodexApprovalDecisionType } from './approvalOptions';

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;

    width: 100%;
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

export const CodexApprovalIntervention = ({
  actionsPortalTarget,
  apiName,
  args,
  onInteractionAction,
}: BuiltinInterventionProps<CodexApprovalArguments>) => {
  const { t } = useTranslation('plugin');
  const [submitting, setSubmitting] = useState<string>();
  const decisions = getCodexApprovalDecisions(apiName, args);

  const submit = async (decision: CodexApprovalDecision) => {
    if (!onInteractionAction || submitting) return;
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
    if (type === 'acceptWithExecpolicyAmendment') {
      return t('builtins.codex.approval.acceptSimilarCommands');
    }
    if (typeof decision !== 'string' && 'applyNetworkPolicyAmendment' in decision) {
      const policy = decision.applyNetworkPolicyAmendment.network_policy_amendment;
      return policy.action === 'allow'
        ? t('builtins.codex.approval.allowHost')
        : t('builtins.codex.approval.denyHost');
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
            disabled={Boolean(submitting)}
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
            disabled={Boolean(submitting)}
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
            disabled={Boolean(submitting)}
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

  return (
    <Flexbox gap={8}>
      <div className={styles.hint}>{t('builtins.codex.approval.hint')}</div>
      {actionsPortalTarget ? createPortal(actions, actionsPortalTarget) : actions}
    </Flexbox>
  );
};
