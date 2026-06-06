'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Info } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { CheckerDock, phaseFromStatus, RunArtifact, useVerifyState } from '@/features/Verify';

import { dataSelectors, useConversationStore } from '../../store';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    overflow: hidden;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 16px;
    background: ${token.colorBgContainer};
  `,
  cardFailed: css`
    border-color: ${token.colorErrorBorder};
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
  const { styles, cx } = useStyles();
  const { t } = useTranslation('verify');
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual);
  const operationId = item?.metadata?.verifyOperationId;
  const round = item?.metadata?.verifyRound ?? 1;
  const { data: state } = useVerifyState(operationId ?? null);

  if (!operationId) return null;

  const failed = phaseFromStatus(state?.verifyStatus) === 'failed';

  return (
    <Flexbox paddingBlock={8}>
      <div className={cx(styles.card, failed && styles.cardFailed)}>
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
