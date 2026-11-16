'use client';

import { DraggablePanel, Flexbox, Icon, useResponsive } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PanelRightOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';

import { AcceptanceDrawer } from '../../AcceptanceDrawer';
import ReportViewer from '../../Report/ReportViewer';
import { resolveRoundParam } from '../../utils';
import { useAcceptanceScope } from '../AcceptanceScope';
import { originTopicPanelProps } from '../Conversation/originConversation';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { canViewAcceptanceHistory } from '../visibility';
import AcceptanceInteractionCost from './AcceptanceInteractionCost';
import LedgerPanel from './LedgerPanel';
import { type AcceptanceRound, buildRoundCards } from './roundState';
import { useAcceptanceRailState } from './useAcceptanceRailState';

const styles = stylex.create({
  chipCount: {
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  toggle: {
    cursor: 'pointer',
    position: 'absolute',
    zIndex: 10,
    insetBlockStart: '16px',
    insetInlineEnd: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    alignItems: 'center',
    appearance: 'none',
    margin: '0',
    paddingBlock: '8px',
    paddingInline: '4px',
    font: 'inherit',
    color: cssVar.colorText,
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: '99px',
    backgroundColor: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
});

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
      cards={buildRoundCards(data)}
      footer={<AcceptanceInteractionCost data={data} />}
      hideCollapse={isNarrowViewport}
      highlight={highlightRound}
      onCollapse={() => onExpandChange(false)}
      onOpenReport={openReport}
    />
  );

  return (
    <>
      {!focused && !expand && (
        <button
          aria-label={t('acceptance.ledger.expand')}
          title={t('acceptance.ledger.expand')}
          type={'button'}
          {...stylex.props(styles.toggle)}
          onClick={() => onExpandChange(true)}
        >
          <Icon icon={PanelRightOpen} size={14} />
          <span {...stylex.props(styles.chipCount)}>{(data.rounds ?? []).length}</span>
        </button>
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
