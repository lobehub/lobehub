import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Handle, Position, useNodeId } from '@xyflow/react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CirclePause,
  CircleX,
  Maximize2,
} from 'lucide-react';
import { use } from 'react';
import { useTranslation } from 'react-i18next';

import { FlowAnchorContext } from './flowAnchor';
import type { FlowGraphData } from './flowGraph';
import { flowStateBackground, flowStateColor } from './FlowNode';

const styles = stylex.create({
  group: {
    overflow: 'hidden',
    width: '100%',
    height: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  header: {
    height: '36px',
    paddingInline: '16px',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
  collapsed: { cursor: 'pointer', height: '100%', paddingBlock: '12px', paddingInline: '12px' },
  glyph: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    borderRadius: cssVar.borderRadius,
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
  summary: { fontSize: '11px', lineHeight: '16px', color: cssVar.colorTextTertiary },
  handle: {
    width: '1px',
    minWidth: '0',
    height: '1px',
    minHeight: '0',
    borderStyle: 'none',
    opacity: 0,
  },
});

export function FlowGroup({ data }: { data: FlowGraphData }) {
  const { t } = useTranslation('verify');
  const anchor = use(FlowAnchorContext);
  const nodeId = useNodeId();
  // Name this group as the one to follow once the new layout lands.
  const toggle = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    anchor.current = nodeId;
    data.onToggle?.();
  };
  const statusIcon =
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
    <>
      <Handle
        className={stylex.props(styles.handle).className}
        id="in"
        position={Position.Left}
        type="target"
      />
      <div {...stylex.props(styles.group)}>
        {data.collapsed ? (
          <Flexbox
            horizontal
            align="flex-start"
            className={stylex.props(styles.collapsed).className}
            gap={10}
            role="button"
            onClick={toggle}
          >
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
            <Flexbox flex={1} gap={3} style={{ minWidth: 0 }}>
              <span {...stylex.props(styles.title)}>{data.title}</span>
              <span {...stylex.props(styles.summary)}>
                {`${data.passed}/${data.total} · ${t(`flow.state.${data.state ?? 'pending'}`)}`}
                {Boolean(data.reviewed) &&
                  ` · ${t('flow.groupReviewed', { count: data.reviewed })}`}
              </span>
            </Flexbox>
            <Flexbox horizontal align="center" gap={2} style={{ flex: 'none' }}>
              {data.onToggle && (
                <Button
                  aria-label={t('flow.expandGroup', { title: data.title })}
                  className="nodrag nopan"
                  size="small"
                  type="text"
                  onClick={toggle}
                >
                  <Icon icon={ChevronRight} size={16} />
                </Button>
              )}
              {data.onEnter && (
                <Button
                  aria-label={t('flow.enterGroup', { title: data.title })}
                  className="nodrag nopan"
                  size="small"
                  type="text"
                  onClick={(e) => {
                    e.stopPropagation();
                    data.onEnter?.();
                  }}
                >
                  <Icon icon={Maximize2} size={14} />
                </Button>
              )}
            </Flexbox>
          </Flexbox>
        ) : (
          <Flexbox
            horizontal
            align="center"
            className={stylex.props(styles.header).className}
            gap={8}
          >
            {data.onToggle && (
              <Button
                aria-label={t('flow.collapseGroup', { title: data.title })}
                className="nodrag nopan"
                size="small"
                type="text"
                onClick={toggle}
              >
                <Icon icon={ChevronDown} size={16} />
              </Button>
            )}
            <Icon icon={statusIcon} size={18} style={{ color: flowStateColor(data.state) }} />
            <Text ellipsis fontSize={13} style={{ flex: 1 }}>
              {data.title}
            </Text>
            <Text fontSize={12} type="secondary">
              {`${data.passed}/${data.total}`}
            </Text>
            {Boolean(data.reviewed) && (
              <Text fontSize={12} type="secondary">
                {t('flow.groupReviewed', { count: data.reviewed })}
              </Text>
            )}
            {data.onEnter && (
              <Button
                aria-label={t('flow.enterGroup', { title: data.title })}
                className="nodrag nopan"
                size="small"
                type="text"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onEnter?.();
                }}
              >
                <Icon icon={Maximize2} size={14} />
              </Button>
            )}
          </Flexbox>
        )}
      </div>
      <Handle
        className={stylex.props(styles.handle).className}
        id="stack-in"
        position={Position.Top}
        type="target"
      />
      <Handle
        className={stylex.props(styles.handle).className}
        id="stack-out"
        position={Position.Bottom}
        type="source"
      />
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
