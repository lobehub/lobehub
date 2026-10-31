'use client';

import { Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEntityMarkdown } from '@/features/EntityLink';
import { useActivityTime } from '@/hooks/useActivityTime';

import type { GoalGraphView, GoalNodeView } from './goalGraphViewModel';
import { KindDot } from './shared';

/**
 * What the goal currently believes. Borderless rows — a finding is reading
 * material, not a control — and clicking one expands its evidence in place:
 * the question it answers and the task that produced it.
 */

const styles = stylex.create({
  arrow: { flex: 'none', color: cssVar.colorTextQuaternary, transition: 'transform 0.2s' },
  arrowOpen: { transform: 'rotate(90deg)' },
  body: {
    paddingBlockStart: '0',
    paddingBlockEnd: '10px',
    paddingInlineStart: '30px',
    paddingInlineEnd: '8px',
  },
  source: { flex: 'none', maxWidth: '40%', textAlign: 'end' },
  time: { flex: 'none', minWidth: '60px', textAlign: 'end' },
  row: {
    cursor: 'pointer',
    marginInline: '-8px',
    paddingBlock: '8px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadiusSM,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

const FindingRow = memo<{ onSelect: (nodeId: string) => void; view: GoalNodeView }>(
  ({ onSelect, view }) => {
    const { t } = useTranslation('chat');
    const [open, setOpen] = useState(false);
    const markdownProps = useEntityMarkdown();
    const { text, title } = useActivityTime(view.node.resolvedAt ?? view.node.createdAt);
    const answered = view.answers[0];

    return (
      <Flexbox gap={0}>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.row).className}
          gap={8}
          onClick={() => setOpen(!open)}
        >
          <Icon
            className={stylex.props(styles.arrow, open && styles.arrowOpen).className}
            icon={ChevronRight}
            size={14}
          />
          <KindDot kind={'finding'} />
          {/* The title takes the slack so the attribution and the timestamp
              line up as columns, matching the deliverables list directly
              above — otherwise the two adjacent sections read as different
              layouts of the same row. */}
          <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={500}>
            {view.node.title}
          </Text>
          <Text
            ellipsis
            className={stylex.props(styles.source).className}
            fontSize={12}
            type={'secondary'}
          >
            {answered
              ? t('goalProcess.findings.answers', { title: answered.title })
              : view.producedBy
                ? t('goalProcess.findings.from', { title: view.producedBy.title })
                : ''}
          </Text>
          <Text
            className={stylex.props(styles.time).className}
            fontSize={12}
            title={title}
            type={'secondary'}
          >
            {text}
          </Text>
        </Flexbox>
        {open && (
          <Flexbox className={stylex.props(styles.body).className} gap={8}>
            {view.answers.map((problem) => (
              <Flexbox
                horizontal
                align={'center'}
                gap={6}
                key={problem.id}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect(problem.id)}
              >
                <KindDot kind={'problem'} />
                <Text fontSize={12} type={'secondary'}>
                  {t('goalProcess.findings.answers', { title: problem.title })}
                </Text>
              </Flexbox>
            ))}
            {/* The description is the producing run's handoff — actual Markdown
                (tables, code blocks), not plain text. Render it as such. */}
            {view.node.description && (
              <Markdown fontSize={13} variant={'chat'} {...markdownProps}>
                {view.node.description}
              </Markdown>
            )}
            {view.producedBy && (
              <Flexbox
                horizontal
                align={'center'}
                gap={6}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect(view.producedBy!.id)}
              >
                <KindDot kind={'task'} />
                <Text fontSize={12} type={'secondary'}>
                  {t('goalProcess.findings.from', { title: view.producedBy.title })}
                </Text>
              </Flexbox>
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

FindingRow.displayName = 'GoalFindingRow';

const Findings = memo<{ graph: GoalGraphView; onSelect: (nodeId: string) => void }>(
  ({ graph, onSelect }) => {
    const { t } = useTranslation('chat');
    const findings = [...graph.findings].sort(
      (a, b) =>
        (b.node.resolvedAt ?? b.node.createdAt).getTime() -
        (a.node.resolvedAt ?? a.node.createdAt).getTime(),
    );

    if (findings.length === 0)
      return (
        <Text fontSize={13} type={'secondary'}>
          {t('goalProcess.findings.empty')}
        </Text>
      );

    return (
      <Flexbox gap={0}>
        {findings.map((view) => (
          <FindingRow key={view.node.id} view={view} onSelect={onSelect} />
        ))}
      </Flexbox>
    );
  },
);

Findings.displayName = 'GoalFindings';

export default Findings;
