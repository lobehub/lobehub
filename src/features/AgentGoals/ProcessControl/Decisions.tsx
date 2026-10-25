'use client';

import { ActionIcon, cssVar, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar as vars } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowRight, ArrowUpRight, ChevronRight } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActivityTime } from '@/hooks/useActivityTime';

import DecisionGraph from './DecisionGraph';
import { buildDecisionGraph } from './decisionGraphModel';
import { buildDecisionRows, type DecisionRow } from './decisionList';
import { AgentActor, UserActor } from './GoalActors';
import type { GoalGraphView } from './goalGraphViewModel';
import { useDecisionCopy } from './GoalResultFollowUps';

/**
 * Every call this goal stopped to ask, and who answered it — the trace behind
 * "why did it go this way". Open questions lead, then settled ones newest
 * first, each with the answer picked, any guidance written with it, and the
 * person or agent who gave it. A row opens into a graph of the decision (see
 * `DecisionGraph`): what raised it, the options it offered, where the answer
 * went. Open questions start opened.
 *
 * Answering still happens where the question is raised (the frontier); the
 * arrow on a row opens the node it was asked on.
 */

const styles = stylex.create({
  divided: {
    borderBlockStartColor: vars.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
  },
  arrow: {
    color: vars.colorTextQuaternary,
    flexShrink: 0,
    transitionDuration: '0.2s',
    transitionProperty: 'transform',
  },
  arrowOpen: {
    transform: 'rotate(90deg)',
  },
  row: {
    paddingBlock: 10,
    paddingInline: 8,
  },
  toggle: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 0,
    cursor: 'pointer',
    display: 'flex',
    flexGrow: 1,
    gap: 6,
    minWidth: 0,
    outlineColor: vars.colorPrimary,
    outlineOffset: 2,
    outlineStyle: {
      ':focus-visible': 'solid',
      'default': 'none',
    },
    outlineWidth: 2,
    padding: 0,
    textAlign: 'start',
  },
});

/** A fixed slot for the timestamp, so the decider and time stay in columns across rows. */
const TIME_STYLE = { flex: 'none', minWidth: 60, textAlign: 'end' } as const;

const Decider = memo<{ row: DecisionRow }>(({ row }) => {
  const { t } = useTranslation('chat');
  const { decision } = row;

  if (row.actor === 'user') return <UserActor userId={decision.resolvedByUserId} />;
  if (row.actor === 'agent' && decision.resolvedByAgentId)
    return <AgentActor agentId={decision.resolvedByAgentId} />;
  if (row.actor === 'pending')
    return <Tag size={'small'}>{t('goalProcess.decisions.pending')}</Tag>;

  return (
    <Text fontSize={13} style={{ flex: 'none' }} type={'secondary'} weight={500}>
      {t('goalProcess.decision.system')}
    </Text>
  );
});

Decider.displayName = 'GoalDecisionDecider';

const DecisionTime = memo<{ at: Date; compact?: boolean }>(({ at, compact }) => {
  const { text, title } = useActivityTime(at);
  return (
    <Text
      fontSize={12}
      style={compact ? { flex: 'none' } : TIME_STYLE}
      title={title}
      type={'secondary'}
    >
      {text}
    </Text>
  );
});

DecisionTime.displayName = 'GoalDecisionTime';

const DecisionRowView = memo<{
  copy: ReturnType<ReturnType<typeof useDecisionCopy>>;
  divided: boolean;
  onSelect: (nodeId: string) => void;
  row: DecisionRow;
  /** The task whose gate this is, when the question was raised by one. */
  subject?: { id: string; title: string };
}>(({ copy, divided, onSelect, row, subject }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(row.actor === 'pending');
  const { decision } = row;

  return (
    <Flexbox gap={6} {...stylex.props(styles.row, divided && styles.divided)}>
      <Flexbox horizontal align={'center'} gap={8}>
        <button
          aria-expanded={open}
          type={'button'}
          {...stylex.props(styles.toggle)}
          onClick={() => setOpen(!open)}
        >
          <Icon
            icon={ChevronRight}
            size={14}
            {...stylex.props(styles.arrow, open && styles.arrowOpen)}
          />
          <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={500}>
            {copy.question}
          </Text>
        </button>
        <Decider row={row} />
        <DecisionTime at={row.resolvedAt ?? decision.createdAt} />
        <ActionIcon
          aria-label={t('goalProcess.decisions.openNode')}
          icon={ArrowUpRight}
          size={'small'}
          title={t('goalProcess.decisions.openNode')}
          onClick={() => onSelect(decision.nodeId)}
        />
      </Flexbox>
      {open ? (
        <DecisionGraph
          model={buildDecisionGraph(row, copy.options)}
          result={{
            effectLabel: {
              fail: t('goalProcess.decisions.effect.fail'),
              retire: t('goalProcess.decisions.effect.retire'),
              retry: t('goalProcess.decisions.effect.retry'),
            },
            header: (
              <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                <Decider row={row} />
                <DecisionTime compact at={row.resolvedAt ?? decision.createdAt} />
              </Flexbox>
            ),
          }}
          root={{
            ...(subject
              ? { context: { onOpen: () => onSelect(subject.id), title: subject.title } }
              : {}),
            ...(copy.detail ? { detail: copy.detail } : {}),
            question: copy.question,
          }}
        />
      ) : (
        <>
          {copy.detail && (
            <Text
              fontSize={13}
              style={{ paddingInlineStart: 20, wordBreak: 'break-word' }}
              type={'secondary'}
            >
              {copy.detail}
            </Text>
          )}
          {copy.choice && (
            <Flexbox horizontal align={'flex-start'} gap={6} style={{ paddingInlineStart: 20 }}>
              <Icon
                color={cssVar.colorPrimary}
                icon={ArrowRight}
                size={14}
                style={{ flex: 'none', marginBlockStart: 3 }}
              />
              <Text style={{ wordBreak: 'break-word' }} weight={500}>
                {copy.choice}
              </Text>
            </Flexbox>
          )}
          {row.note && (
            <Text
              fontSize={13}
              style={{ paddingInlineStart: 40, wordBreak: 'break-word' }}
              type={'secondary'}
            >
              {row.note}
            </Text>
          )}
        </>
      )}
    </Flexbox>
  );
});

DecisionRowView.displayName = 'GoalDecisionRowView';

const Decisions = memo<{ graph: GoalGraphView; onSelect: (nodeId: string) => void }>(
  ({ graph, onSelect }) => {
    const { t } = useTranslation('chat');
    const copyOf = useDecisionCopy(graph);
    const rows = buildDecisionRows(graph.decisions);

    if (rows.length === 0)
      return (
        <Text fontSize={13} type={'secondary'}>
          {t('goalProcess.decisions.empty')}
        </Text>
      );

    return (
      <Flexbox gap={0}>
        {rows.map((row, index) => {
          const subjectId = graph.byId[row.decision.nodeId]?.gateSubjectId;
          const subjectNode = subjectId ? graph.byId[subjectId]?.node : undefined;
          return (
            <DecisionRowView
              copy={copyOf(row)}
              divided={index > 0}
              key={row.decision.id}
              row={row}
              subject={subjectNode ? { id: subjectNode.id, title: subjectNode.title } : undefined}
              onSelect={onSelect}
            />
          );
        })}
      </Flexbox>
    );
  },
);

Decisions.displayName = 'GoalDecisions';

export default Decisions;
