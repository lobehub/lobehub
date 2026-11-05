import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { Edge, Node } from '@xyflow/react';
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

const styles = stylex.create({
  item: {
    width: '100%',
    height: 'auto',
    minHeight: '36px',
    paddingBlock: '6px',
    paddingInline: '12px',
    textAlign: 'start',
    whiteSpace: 'normal',
  },
  branch: {
    justifyContent: 'flex-start',
    width: 'fit-content',
    maxWidth: '100%',
    height: 'auto',
    minHeight: '24px',
    paddingBlock: '2px',
    paddingInline: '12px',
    fontSize: '12px',
    lineHeight: '18px',
    textAlign: 'start',
    whiteSpace: 'normal',
  },
  branchContent: { color: cssVar.colorTextTertiary },
  nested: {
    marginInlineStart: '18px',
    paddingInlineStart: '8px',
    borderInlineStartWidth: '1px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
  },
});

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
        className={stylex.props(styles.item).className}
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
        className={stylex.props(styles.branch).className}
        key={branch.edge.id}
        type="text"
        onClick={() => onSelect(branch.edge.id)}
      >
        {/* Top-aligned: a caption that wraps keeps its glyph on the first line and
            its later lines under the text, not under the glyph. */}
        <Flexbox
          horizontal
          align="flex-start"
          className={stylex.props(styles.branchContent).className}
          gap={6}
        >
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
          <Flexbox className={stylex.props(styles.nested).className} gap={2}>
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
            <Flexbox className={stylex.props(styles.nested).className} gap={2}>
              {steps}
            </Flexbox>
          </Flexbox>,
        );
    }
    return out;
  };
  return <Flexbox gap={2}>{buildOutlineTree(nodes, edges).flatMap(renderSequence)}</Flexbox>;
}
