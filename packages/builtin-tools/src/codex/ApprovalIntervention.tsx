'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

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

type ApprovalDecision = 'accept' | 'acceptForSession' | 'cancel' | 'decline';

export const CodexApprovalIntervention = ({
  actionsPortalTarget,
  onInteractionAction,
}: BuiltinInterventionProps) => {
  const { t } = useTranslation('plugin');
  const [submitting, setSubmitting] = useState<ApprovalDecision>();

  const submit = async (decision: ApprovalDecision) => {
    if (!onInteractionAction || submitting) return;
    setSubmitting(decision);
    try {
      await onInteractionAction({ payload: { decision }, type: 'submit' });
    } finally {
      setSubmitting(undefined);
    }
  };

  const actions = (
    <div className={styles.actions}>
      <Button
        loading={submitting === 'cancel'}
        size="small"
        type="text"
        onClick={() => void submit('cancel')}
      >
        {t('builtins.codex.approval.cancel')}
      </Button>
      <Button
        loading={submitting === 'decline'}
        size="small"
        type="text"
        onClick={() => void submit('decline')}
      >
        {t('builtins.codex.approval.decline')}
      </Button>
      <Button
        loading={submitting === 'acceptForSession'}
        size="small"
        type="fill"
        onClick={() => void submit('acceptForSession')}
      >
        {t('builtins.codex.approval.acceptForSession')}
      </Button>
      <Button
        loading={submitting === 'accept'}
        size="small"
        type="primary"
        onClick={() => void submit('accept')}
      >
        {t('builtins.codex.approval.accept')}
      </Button>
    </div>
  );

  return (
    <Flexbox gap={8}>
      <div className={styles.hint}>{t('builtins.codex.approval.hint')}</div>
      {actionsPortalTarget ? createPortal(actions, actionsPortalTarget) : actions}
    </Flexbox>
  );
};
