'use client';

import type { GoalReleaseGateDossier } from '@lobechat/types';
import { ActionIcon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { X } from 'lucide-react';
import { use, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { GoalDecisionAsker } from '@/features/AgentGoals/GoalDecision';

import { FlowPanelHostContext } from '../Flow/FlowPanelHost';
import GateDecision, { type GateDecisionKind } from './GateDecision';
import GateLead from './GateLead';
import GateSection from './GateSection';
import { formatTokenEstimate, summarizeGate } from './gateSummary';
import PlanSection from './PlanSection';
import { gateStyles } from './styles';
import UnitPanel, { type GateSelection, selectionKey } from './UnitPanel';
import { NextRow, ResultRow, UnitList } from './UnitRows';

export type { GateDecisionKind } from './GateDecision';

const styles = stylex.create({
  asker: {
    flex: '1',
    minWidth: 0,
  },
  frame: {
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '84vh',
  },
  frameBody: {
    display: 'flex',
    flex: '1',
    minHeight: 0,
  },
  header: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '12px',
    paddingInline: '24px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  main: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    minWidth: 0,
  },
  mainOnPage: { gap: '24px' },
  page: {
    display: 'flex',
    gap: '24px',
  },
  report: {
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
  },
  scroll: {
    overflowY: 'auto',
    flex: '1',
    minHeight: 0,
    paddingBlock: '24px',
    paddingInline: '24px',
  },
});

interface GateReviewProps {
  dossier: GoalReleaseGateDossier;
  /** Rendered as the review dialog (with its own frame) rather than on the acceptance page. */
  inModal?: boolean;
  onClose?: () => void;
  onDecided?: (decision: GateDecisionKind) => void;
}

const GateReview = ({ dossier, inModal, onClose, onDecided }: GateReviewProps) => {
  const { t } = useTranslation('verify');
  const [selected, setSelected] = useState<GateSelection>();
  const panelHost = use(FlowPanelHostContext);
  const summary = summarizeGate(dossier);
  const selectedKey = selectionKey(selected);

  const report = (
    <div {...stylex.props(styles.report)}>
      <GateLead
        dossier={dossier}
        remaining={summary.remaining}
        reworked={summary.reworked}
        showAsker={!inModal}
      />

      <PlanSection plan={dossier.plan} />

      <GateSection
        extra={
          <span {...stylex.props(gateStyles.meta)}>
            {t('acceptance.gate.unitCount', { count: summary.units.length })}
          </span>
        }
        title={
          dossier.kind === 'probes'
            ? t('acceptance.gate.resultsProbes')
            : t('acceptance.gate.resultsWave')
        }
      >
        <UnitList>
          {summary.units.map((unit) => (
            <ResultRow
              active={selectedKey === unit.nodeId}
              average={summary.average}
              key={unit.nodeId}
              unit={unit}
              onSelect={() => setSelected({ kind: 'result', unit })}
            />
          ))}
        </UnitList>
      </GateSection>

      <GateSection
        title={t('acceptance.gate.nextWaveTitle', { wave: dossier.wave })}
        extra={
          <span {...stylex.props(gateStyles.meta)}>
            {t('acceptance.gate.unitCount', { count: dossier.nextWave.length })}
          </span>
        }
      >
        <UnitList>
          {dossier.nextWave.map((unit) => (
            <NextRow
              active={selectedKey === unit.title}
              key={unit.title}
              title={unit.title}
              onSelect={() => setSelected({ brief: unit.brief, kind: 'next', title: unit.title })}
            />
          ))}
        </UnitList>
        <p {...stylex.props(gateStyles.note)}>
          {t('acceptance.gate.remaining', {
            count: dossier.remainingAfter,
            estimate: formatTokenEstimate(summary.estimate),
          })}
        </p>
        <p {...stylex.props(gateStyles.note)}>{t('acceptance.gate.checks', summary.checks)}</p>
      </GateSection>
    </div>
  );

  const closePanel = () => setSelected(undefined);

  if (!inModal)
    return (
      <div {...stylex.props(styles.page)}>
        <div {...stylex.props(styles.main, styles.mainOnPage)}>
          {report}
          <GateDecision dossier={dossier} onDecided={onDecided} />
        </div>
        {selected &&
          (panelHost ? (
            createPortal(<UnitPanel docked selection={selected} onClose={closePanel} />, panelHost)
          ) : (
            <UnitPanel selection={selected} onClose={closePanel} />
          ))}
      </div>
    );

  const panel = selected && <UnitPanel selection={selected} onClose={closePanel} />;

  return (
    <div {...stylex.props(styles.frame)}>
      <div {...stylex.props(styles.header)}>
        <div {...stylex.props(styles.asker)}>
          <GoalDecisionAsker
            agentId={dossier.agentId}
            category={'judgment'}
            subtitle={t('acceptance.gate.asker', { goal: dossier.goalTitle })}
          />
        </div>
        {onClose && (
          <ActionIcon
            icon={X}
            size={'small'}
            title={t('acceptance.gate.panelClose')}
            onClick={onClose}
          />
        )}
      </div>
      <div {...stylex.props(styles.frameBody)}>
        <div {...stylex.props(styles.main)}>
          <div {...stylex.props(styles.scroll)}>{report}</div>
          <GateDecision inModal dossier={dossier} onDecided={onDecided} />
        </div>
        {panel}
      </div>
    </div>
  );
};

export default GateReview;
