'use client';

import { DraggablePanel, Flexbox } from '@lobehub/ui';
import { ActionIcon, Drawer } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import { PanelRightOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';

import ReportViewer from '../Report/ReportViewer';
import { resolveRoundParam } from '../utils';
import { useAcceptanceScope } from './AcceptanceScope';
import { checkFilterState } from './CheckList';
import LedgerPanel, { type AcceptanceRound } from './LedgerPanel';
import { originTopicPanelProps, useOriginConversation } from './originConversation';
import { useAcceptanceBundle } from './useAcceptanceBundle';
import { canViewAcceptanceHistory } from './visibility';

const styles = createStaticStyles(({ css }) => ({
  toggle: css`
    position: absolute;
    z-index: 10;
    inset-block-start: 16px;
    inset-inline-end: 16px;

    border: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};

    &:hover {
      border-color: ${cssVar.colorBorder};
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
  const originConversation = useOriginConversation();
  const originTopicOpen = Boolean(originConversation?.isOpen);
  const [expand, setExpand] = useState(!embedded);
  const highlightRound = null;
  const focused = Boolean(params.checkId);

  useEffect(() => {
    if (isNarrowViewport) setExpand(false);
  }, [isNarrowViewport]);

  useEffect(() => {
    if (focused) setExpand(false);
  }, [focused]);

  useEffect(() => {
    if (originTopicOpen && !focused) setExpand(true);
  }, [focused, originTopicOpen]);

  if (!data || !canViewAcceptanceHistory(data.isOwner)) return null;

  const urlRoundRaw = searchParams.get('r');
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
        if (round?.run.roundIndex == null) next.delete('r');
        else next.set('r', String(round.run.roundIndex));
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
        agentId={topicProps.agentId}
        title={topicProps.title}
        topicId={topicProps.topicId}
        onBack={() => originConversation?.closeTopicDrawer()}
        onCollapse={() => setExpand(false)}
      />
    ) : null;

  const ledger = (
    <LedgerPanel
      highlight={highlightRound}
      reviewByRound={reviewByRound}
      rounds={data.rounds}
      onCollapse={() => setExpand(false)}
      onOpenReport={openReport}
    />
  );

  return (
    <>
      {!focused && !expand && (
        <ActionIcon
          className={styles.toggle}
          icon={PanelRightOpen}
          size={'small'}
          title={t('acceptance.ledger.expand')}
          onClick={() => setExpand(true)}
        />
      )}
      {isNarrowViewport ? (
        <Drawer
          noHeader
          closable={false}
          containerMaxWidth={'100%'}
          open={expand}
          placement={'right'}
          styles={{ bodyContent: { padding: 0 } }}
          width={'min(340px, 88vw)'}
          onClose={() => setExpand(false)}
        >
          {topic ?? ledger}
        </Drawer>
      ) : (
        <DraggablePanel
          stableLayout
          defaultSize={{ width: 340 }}
          expand={expand}
          minWidth={300}
          placement={'right'}
          style={{ flex: 'none', height: '100%' }}
          onExpandChange={setExpand}
        >
          <Flexbox style={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>
            {topic ?? <Flexbox style={{ height: '100%', overflow: 'auto' }}>{ledger}</Flexbox>}
          </Flexbox>
        </DraggablePanel>
      )}
      <Drawer
        noHeader
        containerMaxWidth={'100%'}
        open={reportRound !== null}
        placement={'right'}
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
      </Drawer>
    </>
  );
};

export default AcceptanceLedgerRail;
