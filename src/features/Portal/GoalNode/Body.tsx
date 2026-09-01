import { Flexbox, Icon, Markdown } from '@lobehub/ui';
import { Button, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { SquareArrowOutUpRight } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildGoalGraphView,
  type GoalNodeView,
} from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';
import { KindDot } from '@/features/AgentGoals/ProcessControl/shared';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { goalSelectors, useGoalStore } from '@/store/goal';

/**
 * Drill-down for one Goal Graph node. Everything rendered here is derived from
 * the same `goal.graph` snapshot the page already holds — no extra fetch. A
 * Work node links onward to its Task detail (the deep half of the chain:
 * node → task → topic conversation).
 */

const styles = createStaticStyles(({ css }) => ({
  attempt: css`
    padding-block: 6px;

    & + & {
      border-block-start: 1px dashed ${cssVar.colorBorderSecondary};
    }
  `,
  label: css`
    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};
  `,
  linkRow: css`
    cursor: pointer;
    border-radius: ${cssVar.borderRadiusSM};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-variant-numeric: tabular-nums;
  `,
}));

const Section = memo<{ children: ReactNode; title: string }>(({ children, title }) => (
  <Flexbox gap={6}>
    <span className={styles.label}>{title}</span>
    {children}
  </Flexbox>
));

Section.displayName = 'GoalNodePortalSection';

/** The complete ledger — unlike the frontier row, no rank gate hides it here. */
const AttemptLedger = memo<{ view: GoalNodeView }>(({ view }) => {
  const { t } = useTranslation('chat');
  if (view.attempts.length === 0) return null;

  return (
    <Section title={t('goalProcess.attempts.title')}>
      <Flexbox gap={0}>
        {view.attempts.map((attempt) => (
          <Flexbox
            horizontal
            align={'baseline'}
            className={styles.attempt}
            gap={10}
            key={attempt.index}
          >
            <Text className={styles.mono} fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
              {dayjs(attempt.startedAt).format('MM-DD HH:mm')}
            </Text>
            <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
              {t('goalProcess.attempts.nth', { index: attempt.index })}
            </Text>
            <Text
              fontSize={12}
              style={{ flex: 'none' }}
              type={
                attempt.outcome === 'passed'
                  ? 'success'
                  : attempt.outcome === 'failed'
                    ? 'danger'
                    : 'secondary'
              }
            >
              {t(`goalProcess.attempts.${attempt.outcome}` as const)}
            </Text>
            <Text fontSize={12} style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
              {attempt.reason ?? ''}
            </Text>
          </Flexbox>
        ))}
      </Flexbox>
    </Section>
  );
});

AttemptLedger.displayName = 'GoalNodePortalAttempts';

const NodeLinkRow = memo<{ onClick: () => void; text: string; view: GoalNodeView }>(
  ({ onClick, text, view }) => (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.linkRow}
      gap={6}
      paddingBlock={4}
      paddingInline={4}
      onClick={onClick}
    >
      <KindDot kind={view.node.kind} />
      <Text ellipsis fontSize={12} type={'secondary'}>
        {text}
      </Text>
    </Flexbox>
  ),
);

NodeLinkRow.displayName = 'GoalNodePortalLink';

const Body = memo(() => {
  const { t } = useTranslation('chat');
  const view = useChatStore(chatPortalSelectors.goalNodeView);
  const openTaskDetail = useChatStore((s) => s.openTaskDetail);
  const openGoalNode = useChatStore((s) => s.openGoalNode);
  const snapshot = useGoalStore(goalSelectors.goalGraph(view?.goalId ?? ''));

  const graph = useMemo(() => (snapshot ? buildGoalGraphView(snapshot) : undefined), [snapshot]);
  if (!view || !graph) return null;

  const nodeView = graph.byId[view.nodeId];
  if (!nodeView) return null;
  const { node } = nodeView;
  const isFinding = node.kind === 'finding';

  return (
    <Flexbox flex={1} gap={16} padding={16} style={{ minHeight: 0, overflowY: 'auto' }}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Tag size={'small'}>{t(`goalProcess.kind.${node.kind}` as const)}</Tag>
        <Tag size={'small'}>{t(`goalProcess.nodeStatus.${node.status}` as const)}</Tag>
        {nodeView.humanTouches.length > 0 && (
          <Tag size={'small'}>{t('goalProcess.node.humanTouched')}</Tag>
        )}
      </Flexbox>

      {node.description &&
        (isFinding ? (
          // A finding's description is the run's handoff — real Markdown, so
          // render it as such instead of pre-wrapped source text.
          <Markdown fontSize={13} variant={'chat'}>
            {node.description}
          </Markdown>
        ) : (
          <Section
            title={
              node.kind === 'task'
                ? t('goalProcess.node.instruction')
                : t('goalProcess.node.description')
            }
          >
            <Text fontSize={13} style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {node.description}
            </Text>
          </Section>
        ))}

      {node.kind === 'decision' && nodeView.decision && (
        <Section title={t('goalProcess.gate.why')}>
          <Text fontSize={13}>{nodeView.decision.question}</Text>
        </Section>
      )}

      <AttemptLedger view={nodeView} />

      {nodeView.findings.length > 0 && (
        <Section title={t('goalProcess.node.producedFindings')}>
          <Flexbox gap={2}>
            {nodeView.findings.map((finding) => {
              const findingView = graph.byId[finding.id];
              if (!findingView) return null;
              return (
                <NodeLinkRow
                  key={finding.id}
                  text={finding.title}
                  view={findingView}
                  onClick={() => openGoalNode(view.goalId, finding.id)}
                />
              );
            })}
          </Flexbox>
        </Section>
      )}

      {nodeView.producedBy && graph.byId[nodeView.producedBy.id] && (
        <Section title={t('goalProcess.node.producedByTitle')}>
          <NodeLinkRow
            text={nodeView.producedBy.title}
            view={graph.byId[nodeView.producedBy.id]}
            onClick={() => openGoalNode(view.goalId, nodeView.producedBy!.id)}
          />
        </Section>
      )}

      {nodeView.blockers.length > 0 && (
        <Section title={t('goalProcess.node.blockers')}>
          <Flexbox gap={2}>
            {nodeView.blockers.map((blocker) => {
              const blockerView = graph.byId[blocker.id];
              if (!blockerView) return null;
              return (
                <NodeLinkRow
                  key={blocker.id}
                  text={blocker.title}
                  view={blockerView}
                  onClick={() => openGoalNode(view.goalId, blocker.id)}
                />
              );
            })}
          </Flexbox>
        </Section>
      )}

      {node.taskId && (
        <Button
          icon={<Icon icon={SquareArrowOutUpRight} />}
          size={'small'}
          style={{ alignSelf: 'flex-start' }}
          onClick={() => openTaskDetail(node.taskId!)}
        >
          {t('goalProcess.node.openTask')}
        </Button>
      )}
    </Flexbox>
  );
});

export default Body;
