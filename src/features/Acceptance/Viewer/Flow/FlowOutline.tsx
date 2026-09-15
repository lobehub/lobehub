import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import type { Edge, Node } from '@xyflow/react';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CirclePause,
  CircleX,
  CornerDownRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { FlowGraphData } from './flowGraph';
import { flowStateColor } from './FlowNode';
import { buildOutlineTree, type OutlineBranch, type OutlineStep } from './flowOutlineTree';

const styles = createStaticStyles(({ css }) => ({
  item: css`
    width: 100%;
    height: auto;
    min-height: 36px;
    padding-block: 6px;
    padding-inline: 12px;

    text-align: start;
    white-space: normal;
  `,
  // A branch is the condition for reaching the next step, not a step of its own.
  // Row-width and body-size type made it read as one more item in the list, so
  // it shrinks to caption scale and hugs its own text.
  branch: css`
    justify-content: flex-start;

    width: fit-content;
    max-width: 100%;
    height: auto;
    min-height: 24px;

    /* Same inline padding as a step row, so the branch glyph sits on the same
       axis as the status glyphs above and below it. */
    padding-block: 2px;
    padding-inline: 12px;

    font-size: 12px;
    line-height: 18px;
    text-align: start;
    white-space: normal;
  `,
  // The button carries its own colour rule, so the caption tone has to sit on
  // the content it wraps.
  branchContent: css`
    color: ${cssVar.colorTextTertiary};
  `,
  nested: css`
    margin-inline-start: 18px;
    padding-inline-start: 8px;
    border-inline-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

/** A readable traversal of the same graph: dependent steps are indented under the branch that leads to them. */
export function FlowOutline({
  nodes,
  edges,
  onSelect,
}: {
  nodes: Node<FlowGraphData>[];
  edges: Edge[];
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation('verify');
  const renderItem = (node: Node<FlowGraphData>) => {
    const { data } = node;
    const group = node.type === 'flowGroup';
    const glyph =
      data.state === 'passed'
        ? CheckCircle2
        : data.state === 'failed'
          ? CircleX
          : data.state === 'blocked'
            ? CirclePause
            : data.state === 'uncertain'
              ? CircleHelp
              : data.state === 'partial'
                ? CircleDot
                : CircleDashed;
    return (
      <Button
        aria-expanded={group ? !data.collapsed : undefined}
        className={styles.item}
        type={data.selected ? 'default' : 'text'}
        onClick={() => (group ? data.onToggle?.() : onSelect(node.id))}
      >
        <Flexbox horizontal align="center" gap={10} width="100%">
          {group && <Icon icon={data.collapsed ? ChevronRight : ChevronDown} size={14} />}
          <Icon
            aria-label={t(`flow.state.${data.state ?? 'pending'}`)}
            icon={glyph}
            size={18}
            style={{ color: flowStateColor(data.state), flex: 'none' }}
          />
          <Text strong={group} style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            {data.title}
          </Text>
          {group ? (
            <Text fontSize={12} type="secondary">
              {data.passed}/{data.total}
            </Text>
          ) : (
            <Icon icon={ChevronRight} size={16} />
          )}
        </Flexbox>
      </Button>
    );
  };
  const renderBranchLabel = (branch: OutlineBranch, reference: boolean) => {
    const label = String(branch.edge.label ?? '');
    // A trigger that merely repeats the next step's title adds nothing above that step.
    if (!reference && (!label || label === branch.target.data.title)) return null;
    return (
      <Button
        className={styles.branch}
        key={branch.edge.id}
        type="text"
        onClick={() => onSelect(branch.edge.id)}
      >
        {/* Top-aligned: a caption that wraps keeps its glyph on the first line and
            its later lines under the text, not under the glyph. */}
        <Flexbox horizontal align="flex-start" className={styles.branchContent} gap={6}>
          <Icon
            icon={reference ? ArrowRight : CornerDownRight}
            size={12}
            style={{ flex: 'none', marginBlockStart: 3 }}
          />
          <span>{reference ? `${label} → ${branch.target.data.title}` : label}</span>
        </Flexbox>
      </Button>
    );
  };
  // A single continuation stays at the same level; a fork indents each path under its branch.
  const renderSequence = (step: OutlineStep): React.ReactNode[] => {
    const out: React.ReactNode[] = [
      <Flexbox gap={2} key={step.node.id}>
        {renderItem(step.node)}
        {step.node.type === 'flowGroup' && !step.node.data.collapsed && (
          <Flexbox className={styles.nested} gap={2}>
            {step.members.flatMap(renderSequence)}
          </Flexbox>
        )}
      </Flexbox>,
    ];
    const expanded = step.branches.filter((branch) => branch.step);
    for (const branch of step.branches) {
      const label = renderBranchLabel(branch, !branch.step);
      if (!branch.step) {
        if (label) out.push(label);
        continue;
      }
      const steps = renderSequence(branch.step);
      if (expanded.length === 1) out.push(label, ...steps);
      else
        out.push(
          <Flexbox gap={2} key={`branch:${branch.edge.id}`}>
            {label}
            <Flexbox className={styles.nested} gap={2}>
              {steps}
            </Flexbox>
          </Flexbox>,
        );
    }
    return out;
  };
  return <Flexbox gap={2}>{buildOutlineTree(nodes, edges).flatMap(renderSequence)}</Flexbox>;
}
