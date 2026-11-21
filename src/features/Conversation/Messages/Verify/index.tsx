'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { CheckerDock, RunResult } from '@/features/Acceptance';
import { useVerifyState } from '@/features/Acceptance/hooks';
import { phaseCardBackground, phaseFromStatus } from '@/features/Acceptance/utils';

import { contextSelectors, dataSelectors, useConversationStore } from '../../store';

const styles = stylex.create({
  card: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '16px',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
});

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
  // A share page is a read-only snapshot. The verify reads are scoped to the
  // run's owner, so an anonymous reader gets 401 and the global handler sends
  // them to /signin; the card's plan actions are owner writes too. Skip the card.
  const isSharePage = useConversationStore(contextSelectors.isSharePage);

  const { data: state } = useVerifyState(isSharePage ? null : (operationId ?? null));
  const phase = phaseFromStatus(state?.verifyStatus);

  if (!operationId || isSharePage) return null;

  return (
    <Flexbox paddingBlock={8}>
      <div
        className={stylex.props(styles.card).className}
        style={{ background: phaseCardBackground(phase, cssVar) }}
      >
        <RunResult embedded operationId={operationId} round={ordinal} />
        <CheckerDock embedded operationId={operationId} />
      </div>
    </Flexbox>
  );
});

VerifyMessage.displayName = 'VerifyMessage';

export default VerifyMessage;
