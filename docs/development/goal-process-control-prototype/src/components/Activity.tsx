import { Block, Button, Empty, Flexbox, Icon, Tag, Text, TextArea } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { BotMessageSquare } from 'lucide-react';
import { memo, useState } from 'react';

import { ACTIVITY_META } from '../model/activity';
import { ago, clock, hhmm } from '../model/format';
import type { ActivityEvent, GoalState } from '../types';
import { SectionHeader } from './SectionHeader';
import { ActorAvatar, KindDot, useSharedStyles } from './shared';

// Mirrors TaskActivities: section header (BotMessageSquare · 活动) → body gap 12 / padding 12 with
// the comment input on top, then newest-first rows. A row is the inline ActivityRow shape:
// avatar · author · agent Tag · text (ellipsis, flex 1) · "· 相对时间" appended in quaternary.
// The event kind decides the fallback avatar icon (model/activity.ts).
// (src/features/AgentTasks/AgentTaskDetail/TaskActivities.tsx + shared/style.ts)

const useStyles = createStyles(({ css, token }) => ({
  row: css`
    padding-block: 4px;
    padding-inline: 9px;
    border-radius: ${token.borderRadiusSM}px;

    &:hover {
      background: ${token.colorFillQuaternary};
    }
  `,
  avatar: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border-radius: 50%;

    color: ${token.colorTextQuaternary};

    background: ${token.colorFillTertiary};
  `,
  text: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 14px;
    color: ${token.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  time: css`
    margin-inline-start: 4px;
    color: ${token.colorTextQuaternary};
  `,
  chip: css`
    cursor: pointer;

    display: inline-flex;
    gap: 5px;
    align-items: center;

    max-width: 260px;
    height: 20px;
    margin-inline-start: 6px;
    padding-inline: 6px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusXS}px;

    font-size: 12px;
    color: ${token.colorTextSecondary};
    vertical-align: middle;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  chipText: css`
    overflow: hidden;
    max-width: 180px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  inputCard: css`
    display: flex;
    gap: 6px;
    align-items: flex-start;

    padding: 8px;
    border: 1px solid transparent;
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorFillTertiary};

    &:focus-within {
      border-color: ${token.colorBorder};
    }
  `,
  detail: css`
    padding-inline-start: 33px;
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
  const { styles } = useStyles();
  const { styles: shared } = useSharedStyles();
  const [open, setOpen] = useState(true);
  const [comment, setComment] = useState('');
  const events = [...state.log].sort((a, b) => b.t - a.t);
  const nodeOf = (e: ActivityEvent) =>
    e.nodeId ? state.nodes.find((n) => n.id === e.nodeId) : undefined;
  const isAgent = (who: string) => who !== '你' && who !== '系统';
  // A finding has no actor worth naming — the system just records what the task produced.
  const isSystemRecord = (e: ActivityEvent) =>
    e.who === '系统' && (e.kind === 'finding' || e.kind === 'abandon');

  return (
    <Flexbox gap={8}>
      <SectionHeader
        icon={BotMessageSquare}
        title="活动"
        count={events.length}
        isOpen={open}
        onToggle={() => setOpen(!open)}
      />
      {open && (
        <Flexbox gap={12} paddingBlock={12} paddingInline={12}>
          <div className={styles.inputCard}>
            <ActorAvatar name="你" size={24} />
            <TextArea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="留下反馈来引导 Agent —— 你的说明会影响下一次尝试…"
              autoSize={{ minRows: 1, maxRows: 4 }}
              variant="borderless"
              style={{ flex: 1, background: 'transparent' }}
            />
            <Button
              size="small"
              shape="round"
              type="text"
              disabled={!comment.trim()}
              onClick={() => {
                onComment(comment);
                setComment('');
              }}
            >
              发送
            </Button>
          </div>
          {events.length === 0 ? (
            <Empty description="暂无活动" icon={BotMessageSquare} style={{ marginTop: 8 }} />
          ) : (
            events.map((e, i) => {
              const meta = ACTIVITY_META[e.kind];
              const node = nodeOf(e);
              return (
                <Flexbox key={i} gap={2}>
                  <Flexbox horizontal align="center" gap={8} className={styles.row}>
                    {isAgent(e.who) ? (
                      <ActorAvatar name={e.who} size={24} />
                    ) : (
                      <div className={styles.avatar}>
                        <Icon icon={meta.icon} size={12} />
                      </div>
                    )}
                    {!isSystemRecord(e) && (
                      <Text fontSize={14} weight={500} style={{ flexShrink: 0 }}>
                        {e.who}
                      </Text>
                    )}
                    {isAgent(e.who) && <Tag size="small">Agent</Tag>}
                    <span className={styles.text}>
                      {e.text}
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
                      <span className={styles.time} title={hhmm(e.t)}>
                        · {ago(clock.now - e.t)}
                      </span>
                    </span>
                  </Flexbox>
                  {e.detail && <span className={styles.detail}>{e.detail}</span>}
                </Flexbox>
              );
            })
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});
