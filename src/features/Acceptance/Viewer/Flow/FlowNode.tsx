'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Handle, Position } from '@xyflow/react';
import {
  CheckCircle2,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CirclePause,
  CircleX,
  Paperclip,
  Repeat2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface FlowNodeData extends Record<string, unknown> {
  attempts: number;
  evidence: number;
  expected: string;
  selected: boolean;
  state?: 'passed' | 'failed' | 'uncertain' | 'blocked' | 'partial';
  title: string;
}

export const flowStateBackground = (state?: string) =>
  state === 'passed'
    ? cssVar.colorSuccessBg
    : state === 'failed'
      ? cssVar.colorErrorBg
      : state
        ? cssVar.colorWarningBg
        : cssVar.colorFillTertiary;

export const flowStateColor = (state?: string) =>
  state === 'passed'
    ? cssVar.colorSuccess
    : state === 'failed'
      ? cssVar.colorError
      : state
        ? cssVar.colorWarning
        : cssVar.colorTextTertiary;

const styles = stylex.create({
  card: {
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    width: '260px',
    height: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorPrimaryBorder },
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    transition: 'border-color 0.15s,\n      box-shadow 0.15s',
  },
  selected: {
    borderColor: cssVar.colorPrimaryBorder,
    boxShadow: `0 0 0 2px ${cssVar.colorPrimaryBg}`,
  },
  head: { paddingBlock: '12px', paddingInline: '12px' },
  glyph: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  title: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    fontSize: '13px',
    fontWeight: 500,
    lineHeight: 1.4,
  },
  subtitle: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    fontSize: '11px',
    lineHeight: '16px',
    color: cssVar.colorTextTertiary,
  },
  footer: {
    marginBlockStart: 'auto',
    paddingBlock: '7px',
    paddingInline: '12px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'dashed',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
  },
  handle: {
    width: '1px',
    minWidth: '0',
    height: '1px',
    minHeight: '0',
    borderStyle: 'none',
    opacity: 0,
  },
});

/** Same status/head/summary hierarchy as Goal's exploration cards. */
export function FlowNode({ data }: { data: FlowNodeData }) {
  const { t } = useTranslation('verify');
  const statusIcon =
    data.state === 'passed'
      ? CheckCircle2
      : data.state === 'failed'
        ? CircleX
        : data.state === 'blocked'
          ? CirclePause
          : data.state === 'partial'
            ? CircleDot
            : data.state === 'uncertain'
              ? CircleHelp
              : CircleDashed;
  return (
    <>
      <Handle
        className={stylex.props(styles.handle).className}
        id="in"
        position={Position.Left}
        type="target"
      />
      <div {...stylex.props(styles.card, data.selected && styles.selected)}>
        <Flexbox horizontal className={stylex.props(styles.head).className} gap={10}>
          <div
            aria-label={t(`flow.state.${data.state ?? 'pending'}`)}
            className={stylex.props(styles.glyph).className}
            role="img"
            style={{
              background: flowStateBackground(data.state),
              color: flowStateColor(data.state),
            }}
          >
            <Icon icon={statusIcon} size={24} />
          </div>
          <Flexbox gap={3} style={{ minWidth: 0 }}>
            <span {...stylex.props(styles.title)}>{data.title}</span>
            <span {...stylex.props(styles.subtitle)}>{data.expected}</span>
          </Flexbox>
        </Flexbox>
        <Flexbox
          horizontal
          align="center"
          className={stylex.props(styles.footer).className}
          gap={12}
        >
          <Flexbox horizontal align="center" gap={4}>
            <Icon icon={Repeat2} size={12} />
            {data.attempts}
          </Flexbox>
          <Flexbox horizontal align="center" gap={4}>
            <Icon icon={Paperclip} size={12} />
            {data.evidence}
          </Flexbox>
        </Flexbox>
      </div>
      <Handle
        className={stylex.props(styles.handle).className}
        id="out"
        position={Position.Right}
        type="source"
      />
      <Handle
        className={stylex.props(styles.handle).className}
        id="return-in"
        position={Position.Bottom}
        style={{ left: '35%' }}
        type="target"
      />
      <Handle
        className={stylex.props(styles.handle).className}
        id="return-out"
        position={Position.Bottom}
        style={{ left: '65%' }}
        type="source"
      />
    </>
  );
}
