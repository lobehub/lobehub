'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Handle, Position } from '@xyflow/react';
import { createStaticStyles, cssVar, cx } from 'antd-style';
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

const styles = createStaticStyles(({ css }) => ({
  card: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: 260px;
    height: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    transition:
      border-color 0.15s,
      box-shadow 0.15s;

    &:hover {
      border-color: ${cssVar.colorPrimaryBorder};
    }
  `,
  selected: css`
    border-color: ${cssVar.colorPrimaryBorder};
    box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBg};
  `,
  head: css`
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

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
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
  subtitle: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: 11px;
    line-height: 16px;
    color: ${cssVar.colorTextTertiary};
  `,
  footer: css`
    margin-block-start: auto;
    padding-block: 7px;
    padding-inline: 12px;
    border-block-start: 1px dashed ${cssVar.colorBorderSecondary};

    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  handle: css`
    width: 1px;
    min-width: 0;
    height: 1px;
    min-height: 0;
    border: none;

    opacity: 0;
  `,
}));

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
      <Handle className={styles.handle} id="in" position={Position.Left} type="target" />
      <div className={cx(styles.card, data.selected && styles.selected)}>
        <Flexbox horizontal className={styles.head} gap={10}>
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
          <Flexbox gap={3} style={{ minWidth: 0 }}>
            <span className={styles.title}>{data.title}</span>
            <span className={styles.subtitle}>{data.expected}</span>
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align="center" className={styles.footer} gap={12}>
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
