import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { Handle, Position, useNodeId } from '@xyflow/react';
import { createStaticStyles, cssVar } from 'antd-style';
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

const styles = createStaticStyles(({ css }) => ({
  group: css`
    overflow: hidden;

    width: 100%;
    height: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  header: css`
    height: 36px;
    padding-inline: 16px;
    background: transparent;
  `,
  collapsed: css`
    cursor: pointer;
    height: 100%;
    padding-block: 12px;
    padding-inline: 12px;
  `,
  glyph: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: ${cssVar.borderRadius};
  `,
  title: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: 13px;
    font-weight: 500;
    line-height: 1.4;
  `,
  summary: css`
    font-size: 11px;
    line-height: 16px;
    color: ${cssVar.colorTextTertiary};
  `,
  handle: css`
    width: 1px;
    min-width: 0;
    height: 1px;
    min-height: 0;
    border: 0;

    opacity: 0;
  `,
}));

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
      <Handle className={styles.handle} id="in" position={Position.Left} type="target" />
      <div className={styles.group}>
        {data.collapsed ? (
          <Flexbox
            horizontal
            align="flex-start"
            className={styles.collapsed}
            gap={10}
            role="button"
            onClick={toggle}
          >
            <div
              aria-label={t(`flow.state.${data.state ?? 'pending'}`)}
              className={styles.glyph}
              role="img"
              style={{
                background: flowStateBackground(data.state),
                color: flowStateColor(data.state),
              }}
            >
              <Icon icon={statusIcon} size={24} />
            </div>
            <Flexbox flex={1} gap={3} style={{ minWidth: 0 }}>
              <span className={styles.title}>{data.title}</span>
              <span className={styles.summary}>
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
          <Flexbox horizontal align="center" className={styles.header} gap={8}>
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
      <Handle className={styles.handle} id="stack-in" position={Position.Top} type="target" />
      <Handle className={styles.handle} id="stack-out" position={Position.Bottom} type="source" />
      <Handle className={styles.handle} id="out" position={Position.Right} type="source" />
      <Handle
        className={styles.handle}
        id="return-in"
        position={Position.Bottom}
        style={{ left: '35%' }}
        type="target"
      />
      <Handle
        className={styles.handle}
        id="return-out"
        position={Position.Bottom}
        style={{ left: '65%' }}
        type="source"
      />
    </>
  );
}
