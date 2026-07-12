'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { CheckerDock, RunResult } from '@/features/Verify';
import { useVerifyState } from '@/features/Verify/hooks';
import { phaseCardBackground, phaseFromStatus } from '@/features/Verify/utils';

import { dataSelectors, useConversationStore } from '../../store';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;
    background: ${cssVar.colorBgElevated};
  `,
}));

interface VerifyMessageProps {
  id: string;
  index: number;
}

/**
 * Renders a `role='verify'` message — the Agent Run delivery-checker card. The
 * run's `operationId` is carried on `metadata.verifyOperationId`. Renders as a
 * single card: the run result header (round + status) on top, then the checker
 * results + actions. Unlike assistant/user messages this is a standalone card
 * group (no avatar bubble).
 */
const VerifyMessage = memo<VerifyMessageProps>(({ id }) => {
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual);
  const operationId = item?.metadata?.verifyOperationId;
  // Sequence number among all verify messages in the thread (not the repair round).
  const ordinal = useConversationStore(dataSelectors.getVerifyOrdinal(id));

  const { data: state } = useVerifyState(operationId ?? null);
  const phase = phaseFromStatus(state?.verifyStatus);

  if (!operationId) return null;

  return (
    <Flexbox paddingBlock={8}>
      <div className={styles.card} style={{ background: phaseCardBackground(phase, cssVar) }}>
        <RunResult embedded operationId={operationId} round={ordinal} />
        <CheckerDock embedded operationId={operationId} />
      </div>
    </Flexbox>
  );
});

VerifyMessage.displayName = 'VerifyMessage';

export default VerifyMessage;
