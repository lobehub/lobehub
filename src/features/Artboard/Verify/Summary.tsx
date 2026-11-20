import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowUpRightIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAcceptanceOrigin } from '@/features/Acceptance/origin';
import { FLOW_HASH } from '@/features/Acceptance/Viewer/Comments/anchor';

import { useBoard } from '../BoardContext';
import { type JourneyView, nodeState } from './flow';
import { useBoardAcceptance, useJourneyView } from './useJourneyView';

const styles = stylex.create({
  link: {
    alignItems: 'center',
    color: {
      ':hover': cssVar.colorText,
      'default': cssVar.colorTextSecondary,
    },
    cursor: 'pointer',
    display: 'inline-flex',
    flex: 'none',
    fontSize: 12,
    whiteSpace: 'nowrap',
    gap: 2,
    marginInlineStart: 'auto',
  },
});

const FlowLink = () => {
  const { t } = useTranslation('project');
  const { acceptanceId } = useBoardAcceptance();
  const origin = useAcceptanceOrigin();
  if (!acceptanceId) return null;
  return (
    <a
      {...stylex.props(styles.link)}
      href={`${origin}/acceptance/${acceptanceId}${FLOW_HASH}`}
      rel="noopener"
      target="_blank"
    >
      {t('artboard.verify.flowLink')}
      <Icon icon={ArrowUpRightIcon} size={12} />
    </a>
  );
};

export const resultCounts = (view: JourneyView | undefined, boardIds: string[]) => {
  const counts = { blocked: 0, checked: 0, failed: 0, total: boardIds.length };
  for (const id of boardIds) {
    const state = nodeState(view, id);
    if (!state) continue;
    counts.checked += 1;
    if (state === 'failed') counts.failed += 1;
    else if (state !== 'passed') counts.blocked += 1;
  }
  return counts;
};

export const useCheckBoards = () =>
  useBoard().journeyBoards.filter((item) => item.type !== 'decision');

const Summary = () => {
  const { t } = useTranslation('project');
  const journey = useJourneyView();
  const checks = useCheckBoards();
  if (!journey?.run)
    return (
      <Flexbox horizontal align="center" gap={8}>
        <Text style={{ fontSize: 12 }} type="secondary">
          {t('artboard.verify.waiting')}
        </Text>
        <FlowLink />
      </Flexbox>
    );

  const counts = resultCounts(
    journey,
    checks.map((item) => item.id),
  );
  return (
    <Flexbox horizontal align="center" gap={8} wrap="wrap">
      <Text style={{ fontSize: 12 }} type="secondary">
        {t('artboard.verify.summary', counts)}
      </Text>
      {counts.failed > 0 && (
        <Text style={{ fontSize: 12 }} type="danger">
          {t('artboard.verify.summaryFailed', { count: counts.failed })}
        </Text>
      )}
      {counts.blocked > 0 && (
        <Text style={{ fontSize: 12 }} type="warning">
          {t('artboard.verify.summaryBlocked', { count: counts.blocked })}
        </Text>
      )}
      <FlowLink />
    </Flexbox>
  );
};

export default Summary;
