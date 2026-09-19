'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { DraggablePanel, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import { PanelRightOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';

import { AcceptanceDrawer } from '../../AcceptanceDrawer';
import ReportViewer from '../../Report/ReportViewer';
import { resolveRoundParam } from '../../utils';
import { useAcceptanceScope } from '../AcceptanceScope';
import { checkFilterState } from '../Checks/checkState';
import { originTopicPanelProps } from '../Conversation/originConversation';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { canViewAcceptanceHistory } from '../visibility';
import LedgerPanel, { type AcceptanceRound } from './LedgerPanel';
import { useAcceptanceRailState } from './useAcceptanceRailState';

const styles = createStaticStyles(({ css }) => ({
  chipCount: css`
    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  /**
   * Collapsed, the run ledger is a VERTICAL chip hugging the content's right
   * edge: the rounds are the page's audit trail, not its reading material, so
   * the affordance keeps the column it would otherwise occupy down to a
   * thumb-width strip. The icon plus the round count carry it — spelling the
   * label out sideways would cost the width the collapse just bought back.
   */
  toggle: css`
    cursor: pointer;

    position: absolute;
    z-index: 10;
    inset-block-start: 16px;
    inset-inline-end: 12px;

    padding-block: 8px;
    padding-inline: 5px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 99px;

    background: ${cssVar.colorBgContainer};

    &:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillQuaternary};
    }
  `,
}));

const AcceptanceLedgerRail = () => {
  const { t } = useTranslation('verify');
  const { lg = true } = useResponsive();
  const isNarrowViewport = !lg;
  const params = useParams<{ checkId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { acceptanceId, embedded } = useAcceptanceScope();
  const { data } = useAcceptanceBundle(acceptanceId);
  const focused = Boolean(params.checkId);
  const { expand, onExpandChange, originConversation } = useAcceptanceRailState({
    focused,
    isNarrowViewport,
  });
  const originTopicOpen = Boolean(originConversation?.isOpen);
  const highlightRound = null;

  if (!data || !canViewAcceptanceHistory(data.isOwner)) return null;

  const urlRoundRaw = searchParams.get('report');
  const reportRound = embedded ? null : resolveRoundParam(data.rounds, urlRoundRaw);
  const reviewableChecks = data.checks;
  const reviewByRound = (() => {
    const map = new Map<number, { accepted: number; total: number }>();
    for (const check of reviewableChecks) {
      const round = check.resultRound;
      if (round === undefined || round === null) continue;
      const cur = map.get(round) ?? { accepted: 0, total: 0 };
      cur.total += 1;
      if (checkFilterState(check) === 'accepted') cur.accepted += 1;
      map.set(round, cur);
    }
    return map;
  })();

  const openReport = (round: AcceptanceRound | null) => {
    if (embedded) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (round?.run.roundIndex == null) next.delete('report');
        else next.set('report', String(round.run.roundIndex));
        return next;
      },
      { replace: true },
    );
  };

  const TopicPanel = originConversation?.TopicPanel;
  const topicProps = originTopicPanelProps({
    isOpen: originTopicOpen,
    origin: data.origin,
    subjectTitle: data.subject.title,
  });
  const topic =
    topicProps && TopicPanel ? (
      <TopicPanel
        agentAvatar={topicProps.agentAvatar}
        agentBackgroundColor={topicProps.agentBackgroundColor}
        agentId={topicProps.agentId}
        title={topicProps.title}
        topicId={topicProps.topicId}
        onCollapse={() => onExpandChange(false)}
      />
    ) : null;

  const ledger = (
    <LedgerPanel
      hideCollapse={isNarrowViewport}
      highlight={highlightRound}
      reviewByRound={reviewByRound}
      rounds={data.rounds}
      onCollapse={() => onExpandChange(false)}
      onOpenReport={openReport}
    />
  );

  return (
    <>
      {!focused && !expand && (
        <Flexbox
          align={'center'}
          className={styles.toggle}
          gap={5}
          title={t('acceptance.ledger.expand')}
          onClick={() => onExpandChange(true)}
        >
          <Icon icon={PanelRightOpen} size={14} />
          <Text className={styles.chipCount}>{data.rounds.length}</Text>
        </Flexbox>
      )}
      {isNarrowViewport ? (
        <AcceptanceDrawer
          noHeader
          containerMaxWidth={'100%'}
          open={expand}
          placement={'right'}
          styles={{ bodyContent: { padding: 0 } }}
          title={t('acceptance.ledger.title')}
          width={'min(340px, 88vw)'}
          onClose={() => onExpandChange(false)}
        >
          {topic ?? ledger}
        </AcceptanceDrawer>
      ) : (
        <DraggablePanel
          backgroundColor={cssVar.colorBgLayout}
          defaultSize={{ width: 340 }}
          expand={expand}
          minWidth={300}
          placement={'right'}
          style={{ flex: 'none', height: '100%' }}
          onExpandChange={onExpandChange}
        >
          <Flexbox style={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>
            {topic ?? <Flexbox style={{ height: '100%', overflow: 'auto' }}>{ledger}</Flexbox>}
          </Flexbox>
        </DraggablePanel>
      )}
      <AcceptanceDrawer
        noHeader
        containerMaxWidth={'100%'}
        open={reportRound !== null}
        placement={'right'}
        title={t('report.titleFallback')}
        width={'min(960px, 92vw)'}
        styles={{
          bodyContent: { height: '100%', minHeight: 0, overflow: 'hidden', padding: 0 },
        }}
        onClose={() => openReport(null)}
      >
        {reportRound && (
          <Flexbox style={{ height: '100%', position: 'relative' }}>
            <ReportViewer runId={reportRound.run.id} />
          </Flexbox>
        )}
      </AcceptanceDrawer>
    </>
  );
};

export default AcceptanceLedgerRail;
