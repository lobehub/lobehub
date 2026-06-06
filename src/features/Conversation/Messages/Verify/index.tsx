'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Info } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { CheckerDock, RunArtifact } from '@/features/Verify';
import { useVerifyState } from '@/features/Verify/hooks';
import { phaseCardBackground, phaseFromStatus } from '@/features/Verify/utils';

import { dataSelectors, useConversationStore } from '../../store';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    overflow: hidden;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 16px;
    background: ${token.colorBgElevated};
  `,
  foot: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 16px;
    border-block-start: 1px solid ${token.colorBorderSecondary};

    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
}));

interface VerifyMessageProps {
  id: string;
  index: number;
}

/**
 * Renders a `role='verify'` message — the Agent Run delivery-checker card. The
 * run's `operationId` is carried on `metadata.verifyOperationId`. Renders as a
 * single card: the Run Artifact header (round + status) on top, then the checker
 * results + actions, then the snapshot note. Unlike assistant/user messages this
 * is a standalone card group (no avatar bubble).
 */
const VerifyMessage = memo<VerifyMessageProps>(({ id }) => {
  const { styles, theme } = useStyles();
  const { t } = useTranslation('verify');
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual);
  const operationId = item?.metadata?.verifyOperationId;
  const round = item?.metadata?.verifyRound ?? 1;

  const { data: state } = useVerifyState(operationId ?? null);
  const phase = phaseFromStatus(state?.verifyStatus);

  if (!operationId) return null;

  return (
    <Flexbox paddingBlock={8}>
      <div className={styles.card} style={{ background: phaseCardBackground(phase, theme) }}>
        <RunArtifact embedded operationId={operationId} round={round} />
        <CheckerDock embedded operationId={operationId} />
        <div className={styles.foot}>
          <Icon icon={Info} size={14} />
          <span>{t('artifact.foot')}</span>
        </div>
      </div>
    </Flexbox>
  );
});

VerifyMessage.displayName = 'VerifyMessage';

export default VerifyMessage;
