import { Button, Empty, Flexbox, Icon, Tag, Text, TextArea } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { BotMessageSquare, ChevronRight, ExternalLink } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { GOAL_EVENT_META, type GoalEventKind, buildRecords } from '../model/activity';
import { ago, clock, elapsed, hhmm, min, usd } from '../model/format';
import type { ActivityEvent, GoalState } from '../types';
import { SectionHeader } from './SectionHeader';
import { ActorAvatar, KindDot, StatusGlyph, useSharedStyles } from './shared';

// 活动 — one row per node (what that task did, by whom, how it ended), newest first, with the
// per-attempt detail folded underneath. Verifier verdicts, evidence submission and lease recovery
// happen inside a task, so they live in that task's fold, not as separate rows. Goal-level events
// (created / paused / budget / comment / achieved) keep their own rows.
// Row shape follows TaskActivities' inline ActivityRow.

const useStyles = createStyles(({ css, token }) => ({
  row: css`
    cursor: pointer;
    padding-block: 6px;
    padding-inline: 9px;
    border-radius: ${token.borderRadiusSM}px;

    &:hover {
      background: ${token.colorFillQuaternary};
    }
  `,
  plainRow: css`
    padding-block: 6px;
    padding-inline: 9px;
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
  arrow: css`
    flex: none;
    color: ${token.colorTextQuaternary};
    transition: transform 0.2s;
  `,
  arrowOpen: css`
    transform: rotate(90deg);
  `,
  body: css`
    padding-block: 0 10px;
    padding-inline: 42px 9px;
  `,
  attempt: css`
    padding-block: 6px;
    border-block-start: 1px dashed ${token.colorBorderSecondary};

    &:first-of-type {
      border-block-start: none;
    }
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
  time: css`
    flex: none;
    margin-inline-start: auto;
    color: ${token.colorTextQuaternary};
  `,
}));

interface ActivityProps {
  state: GoalState;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onComment: (text: string) => void;
}

const GOAL_KINDS = new Set<GoalEventKind>([
  'create',
  'pause',
  'resume',
  'budget',
  'comment',
  'achieved',
]);

export const Activity = memo<ActivityProps>(({ state, onHover, onSelect, onComment }) => {
  const { styles, cx } = useStyles();
  const { styles: shared } = useSharedStyles();
  const [open, setOpen] = useState(true);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState('');

  const records = useMemo(() => buildRecords(state), [state]);
  const goalEvents = useMemo(
    () =>
      state.log.filter((e): e is ActivityEvent & { kind: GoalEventKind } =>
        GOAL_KINDS.has(e.kind as GoalEventKind),
      ),
    [state.log],
  );
  const rows = useMemo(
    () =>
      [
        ...records.map((r) => ({ t: r.t, record: r }) as const),
        ...goalEvents.map((e) => ({ t: e.t, event: e }) as const),
      ].sort((a, b) => b.t - a.t),
    [records, goalEvents],
  );
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Flexbox gap={8}>
      <SectionHeader
        icon={BotMessageSquare}
        title="活动"
        count={rows.length}
        isOpen={open}
        onToggle={() => setOpen(!open)}
      />
      {open && (
        <Flexbox gap={8} paddingBlock={12} paddingInline={12}>
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

          {rows.length === 0 && (
            <Empty description="暂无活动" icon={BotMessageSquare} style={{ marginTop: 8 }} />
          )}

          {rows.map((row, i) => {
            if ('event' in row) {
              const meta = GOAL_EVENT_META[row.event.kind];
              return (
                <Flexbox
                  key={`e${i}`}
                  horizontal
                  align="center"
                  gap={8}
                  className={styles.plainRow}
                >
                  {row.event.who === '你' ? (
                    <ActorAvatar name="你" size={24} />
                  ) : (
                    <div className={styles.avatar}>
                      <Icon icon={meta.icon} size={12} />
                    </div>
                  )}
                  <Text fontSize={14} weight={500} style={{ flexShrink: 0 }}>
                    {row.event.who}
                  </Text>
                  <Text fontSize={14} type="secondary" ellipsis style={{ minWidth: 0 }}>
                    {row.event.text}
                  </Text>
                  <Text
                    fontSize={12}
                    className={cx(styles.time, shared.mono)}
                    title={hhmm(row.event.t)}
                  >
                    {ago(clock.now - row.event.t)}
                  </Text>
                </Flexbox>
              );
            }

            const { node, actor, summary, findings } = row.record;
            const isOpen = openIds.has(node.id);
            const attempts = node.attempts ?? [];
            const hasDetail =
              attempts.length > 0 || findings.length > 0 || !!node.humanTouches?.length;
            const running = node.kind === 'work' && node.status === 'active' && !node.delivered;
            return (
              <Flexbox key={node.id} gap={0}>
                <Flexbox
                  horizontal
                  align="center"
                  gap={8}
                  className={styles.row}
                  onClick={() => (hasDetail ? toggle(node.id) : onSelect(node.id))}
                  onMouseEnter={() => onHover(node.id)}
                  onMouseLeave={() => onHover(null)}
                >
                  <Icon
                    icon={ChevronRight}
                    size={14}
                    className={cx(styles.arrow, isOpen && styles.arrowOpen)}
                    style={{ opacity: hasDetail ? 1 : 0 }}
                  />
                  {actor ? <ActorAvatar name={actor} size={24} /> : <KindDot kind={node.kind} />}
                  <Text fontSize={14} weight={500} ellipsis style={{ flexShrink: 1, minWidth: 0 }}>
                    {node.title}
                  </Text>
                  {actor && <Tag size="small">{actor}</Tag>}
                  <Text
                    fontSize={14}
                    type="secondary"
                    ellipsis
                    style={{ flexShrink: 1, minWidth: 0 }}
                  >
                    {summary}
                  </Text>
                  {running && node.startedAt && (
                    <Text
                      fontSize={12}
                      className={cx(shared.muted, shared.mono)}
                      style={{ flexShrink: 0 }}
                    >
                      已运行 {elapsed(clock.now - node.startedAt)}
                    </Text>
                  )}
                  <Text fontSize={12} className={cx(styles.time, shared.mono)} title={hhmm(row.t)}>
                    {ago(clock.now - row.t)}
                  </Text>
                </Flexbox>
                {isOpen && (
                  <Flexbox className={styles.body} gap={10}>
                    {attempts.length > 0 && (
                      <Flexbox gap={0}>
                        {attempts.map((a) => (
                          <Flexbox key={a.n} gap={2} className={styles.attempt}>
                            <Flexbox horizontal gap={8} align="center">
                              <Text fontSize={12} weight={600} style={{ flexShrink: 0 }}>
                                第 {a.n} 次
                              </Text>
                              <Text
                                fontSize={12}
                                type={
                                  a.outcome === 'passed'
                                    ? 'success'
                                    : a.outcome === 'failed'
                                      ? 'danger'
                                      : 'secondary'
                                }
                                style={{ flexShrink: 0 }}
                              >
                                {a.outcome === 'passed'
                                  ? 'verifier 通过'
                                  : a.outcome === 'failed'
                                    ? 'verifier 未通过'
                                    : '失联回收'}
                              </Text>
                              <Text
                                fontSize={12}
                                className={cx(shared.muted, shared.mono)}
                                style={{ flexShrink: 0 }}
                              >
                                {Math.round((a.ended - a.started) / min(1))} 分钟 · {usd(a.cost)}
                              </Text>
                              <Button
                                type="text"
                                size="small"
                                icon={<Icon icon={ExternalLink} />}
                                style={{ marginLeft: 'auto' }}
                              >
                                打开运行
                              </Button>
                            </Flexbox>
                            <Text fontSize={12} type="secondary">
                              {a.reason}
                            </Text>
                          </Flexbox>
                        ))}
                      </Flexbox>
                    )}
                    {findings.map((f) => (
                      <Flexbox
                        key={f.id}
                        horizontal
                        gap={6}
                        align="center"
                        style={{ cursor: 'pointer' }}
                        onClick={() => onSelect(f.id)}
                      >
                        <KindDot kind="finding" />
                        <Text fontSize={13}>沉淀结论：{f.title}</Text>
                      </Flexbox>
                    ))}
                    {node.humanTouches?.map((t, k) => (
                      <Flexbox key={k} horizontal gap={6} align="center">
                        <ActorAvatar name="你" size={16} />
                        <Text fontSize={13}>{t.text}</Text>
                        <Text fontSize={12} className={cx(shared.muted, shared.mono)}>
                          {ago(clock.now - t.t)}
                        </Text>
                      </Flexbox>
                    ))}
                  </Flexbox>
                )}
              </Flexbox>
            );
          })}
        </Flexbox>
      )}
    </Flexbox>
  );
});
