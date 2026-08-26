import { Button, Flexbox, Icon, Text, TextArea } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { memo, useState } from 'react';

import { ACTIVITY_META } from '../model/activity';
import { ago, clock } from '../model/format';
import type { ActivityEvent, GoalState } from '../types';
import { ActorAvatar, KindDot, useSharedStyles } from './shared';

// Linear-style activity feed, driven entirely by ActivityEvent.kind (see model/activity.ts):
// kind → icon + tone; who → avatar; nodeId → chip that highlights the graph. Comment box on top,
// like TaskActivities.

const useStyles = createStyles(({ css, token }) => ({
  feed: css`
    position: relative;
    padding-block: 4px;
    padding-inline: 4px 0;

    &::before {
      content: '';

      position: absolute;
      inset-block: 16px;
      inset-inline-start: 15px;

      width: 1px;

      background: ${token.colorBorderSecondary};
    }
  `,
  row: css`
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding-block: 6px;
  `,
  icon: css`
    position: relative;

    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 12px;

    background: ${token.colorBgContainer};
  `,
  iconWarn: css`
    border-color: ${token.colorWarningBorder};
    background: ${token.colorWarningBg};
  `,
  iconOk: css`
    border-color: ${token.colorSuccessBorder};
    background: ${token.colorSuccessBg};
  `,
  iconBad: css`
    border-color: ${token.colorErrorBorder};
    background: ${token.colorErrorBg};
  `,
  chip: css`
    cursor: pointer;

    display: inline-flex;
    gap: 5px;
    align-items: center;

    max-width: 320px;
    height: 20px;
    padding-inline: 6px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusXS}px;

    font-size: 12px;
    color: ${token.colorTextSecondary};

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  chipText: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  detail: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
}));

interface ActivityProps {
  state: GoalState;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onComment: (text: string) => void;
}

export const Activity = memo<ActivityProps>(({ state, onHover, onSelect, onComment }) => {
  const { styles, cx } = useStyles();
  const { styles: shared } = useSharedStyles();
  const [comment, setComment] = useState('');
  const events = [...state.log].sort((a, b) => b.t - a.t);
  const nodeOf = (e: ActivityEvent) =>
    e.nodeId ? state.nodes.find((n) => n.id === e.nodeId) : undefined;

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal gap={8} align="flex-start">
        <TextArea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="给这个目标留一条说明（进入活动记录，并作为后续尝试的上下文）"
          autoSize={{ minRows: 1, maxRows: 3 }}
          style={{ flex: 1 }}
        />
        <Button
          size="small"
          disabled={!comment.trim()}
          onClick={() => {
            onComment(comment);
            setComment('');
          }}
        >
          发送
        </Button>
      </Flexbox>
      <div className={styles.feed}>
        {events.length === 0 && (
          <Text fontSize={13} className={shared.muted} style={{ paddingLeft: 36 }}>
            还没有任何活动。
          </Text>
        )}
        {events.map((e, i) => {
          const meta = ACTIVITY_META[e.kind];
          const node = nodeOf(e);
          return (
            <div key={i} className={styles.row}>
              <div
                className={cx(
                  styles.icon,
                  meta.tone === 'ok' && styles.iconOk,
                  meta.tone === 'bad' && styles.iconBad,
                  meta.tone === 'warn' && styles.iconWarn,
                )}
                title={meta.label}
              >
                <Icon icon={meta.icon} size={12} />
              </div>
              <Flexbox gap={2} flex={1} style={{ minWidth: 0, paddingTop: 2 }}>
                <Flexbox horizontal gap={6} align="center" wrap="wrap">
                  <ActorAvatar name={e.who} size={16} />
                  <Text fontSize={13} weight={500}>
                    {e.who}
                  </Text>
                  <Text fontSize={13}>{e.text}</Text>
                  {node && (
                    <span
                      className={styles.chip}
                      onMouseEnter={() => onHover(node.id)}
                      onMouseLeave={() => onHover(null)}
                      onClick={() => onSelect(node.id)}
                    >
                      <KindDot kind={node.kind} />
                      <span className={styles.chipText}>{node.title}</span>
                    </span>
                  )}
                </Flexbox>
                {e.detail && <span className={styles.detail}>{e.detail}</span>}
              </Flexbox>
              <Text
                fontSize={12}
                className={cx(shared.muted, shared.mono)}
                style={{ flexShrink: 0, paddingTop: 4 }}
              >
                {ago(clock.now - e.t)}
              </Text>
            </div>
          );
        })}
      </div>
    </Flexbox>
  );
});
