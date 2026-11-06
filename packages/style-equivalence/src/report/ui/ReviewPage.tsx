import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchReview, postReview, type ReviewPayload } from '../api';
import { completionText, keyAction, nextSelection } from '../review';
import { ReviewBar } from './ReviewBar';
import { ReviewItemView } from './ReviewItemView';
import { ReviewQueue } from './ReviewQueue';
import { ReworkPanel } from './ReworkPanel';
import { RunBadge, useFollowRun } from './RunBadge';

const styles = stylex.create({
  center: { color: cssVar.colorTextSecondary, fontSize: 14, padding: 40 },
  done: { color: cssVar.colorTextSecondary, fontSize: 14, lineHeight: 1.8, padding: 40 },
  main: { minHeight: 0, overflowY: 'auto', paddingBlock: 24, paddingInline: 32 },
  page: {
    backgroundColor: cssVar.colorBgLayout,
    color: cssVar.colorText,
    display: 'grid',
    fontFamily: cssVar.fontFamily,
    fontVariantNumeric: 'tabular-nums',
    gridTemplateColumns: '272px 1fr',
    gridTemplateRows: 'auto 1fr auto',
    height: '100vh',
  },
  pill: {
    backgroundColor: cssVar.colorFillTertiary,
    borderRadius: 999,
    color: cssVar.colorTextSecondary,
    fontSize: 12,
    paddingBlock: 4,
    paddingInline: 10,
  },
  pillBack: { backgroundColor: cssVar.colorErrorBg, color: cssVar.colorError },
  pillOk: { backgroundColor: cssVar.colorSuccessBg, color: cssVar.colorSuccess },
  queue: {
    backgroundColor: cssVar.colorBgContainer,
    borderInlineEndColor: cssVar.colorBorderSecondary,
    borderInlineEndStyle: 'solid',
    borderInlineEndWidth: 1,
    gridRowEnd: '4',
    gridRowStart: '2',
    minHeight: 0,
    overflowY: 'auto',
  },
  reworkButton: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorder,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
    height: 32,
    paddingInline: 14,
  },
  sub: { color: cssVar.colorTextTertiary, fontSize: 13 },
  top: {
    alignItems: 'center',
    backgroundColor: cssVar.colorBgContainer,
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    columnGap: 16,
    display: 'flex',
    gridColumnEnd: '-1',
    gridColumnStart: '1',
    paddingBlock: 12,
    paddingInline: 20,
  },
  topEnd: { alignItems: 'center', columnGap: 10, display: 'flex', marginInlineStart: 'auto' },
});

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(target.tagName);

export const ReviewPage = () => {
  const [payload, setPayload] = useState<ReviewPayload>();
  const [current, setCurrent] = useState<string>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [panel, setPanel] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetchReview()
      .then((next) => {
        setPayload(next);
        setCurrent((selected) =>
          selected && next.items.some((entry) => entry.key === selected)
            ? selected
            : nextSelection(next.items, undefined),
        );
      })
      .catch((reason: unknown) => setError(String(reason)));
  }, []);
  useEffect(load, [load]);
  useFollowRun(payload?.follow, load);

  const item = payload?.items.find((entry) => entry.key === current);

  const select = useCallback((key: string | undefined) => {
    setCurrent(key);
    setNote('');
    setError(undefined);
  }, []);

  const act = useCallback(
    async (action: 'pass' | 'rework') => {
      if (!item || busy) return;
      if (action === 'rework' && !note.trim()) return void inputRef.current?.focus();
      setBusy(true);
      try {
        const next = await postReview({ action, key: item.key, note });
        setPayload(next);
        select(nextSelection(next.items, item.key));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy(false);
      }
    },
    [busy, item, note, select],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!payload || event.metaKey || event.ctrlKey || event.altKey) return;
      const action = keyAction(event.key, isTyping(event.target));
      if (!action) return;
      event.preventDefault();
      const index = payload.items.findIndex((entry) => entry.key === current);
      if (action === 'next')
        select(payload.items[Math.min(index + 1, payload.items.length - 1)]?.key);
      if (action === 'previous') select(payload.items[Math.max(index - 1, 0)]?.key);
      if (action === 'pass' && item?.canPass) void act('pass');
      if (action === 'rework') void act('rework');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, current, item, payload, select]);

  if (!payload)
    return (
      <div {...stylex.props(styles.center)}>
        {error ? `读取失败：${error}` : '正在读取复查队列…'}
      </div>
    );
  const { counts } = payload;
  const open = counts.todo + counts.changed;
  return (
    <div {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.top)}>
        <b>
          {payload.pr
            ? `#${payload.pr.number} ${payload.pr.title}`
            : `${payload.run.base.slice(0, 7)}..${payload.run.head.slice(0, 7)}`}
        </b>
        <span {...stylex.props(styles.sub)}>
          工具已自动证明 {counts.proven} 条 · 剩 {payload.items.length} 条要你看
        </span>
        <RunBadge follow={payload.follow} />
        <div {...stylex.props(styles.topEnd)}>
          <span {...stylex.props(styles.pill, styles.pillOk)}>已通过 {counts.passed}</span>
          <span {...stylex.props(styles.pill, styles.pillBack)}>已打回 {counts.reworked}</span>
          <span {...stylex.props(styles.pill)}>待看 {open}</span>
          {counts['waiting-agent'] > 0 && (
            <span {...stylex.props(styles.pill)}>等 agent {counts['waiting-agent']}</span>
          )}
          <button
            type="button"
            onClick={() => setPanel(true)}
            {...stylex.props(styles.reworkButton)}
          >
            查看打回（{counts.reworked}）
          </button>
        </div>
      </header>
      <aside {...stylex.props(styles.queue)}>
        <ReviewQueue current={current} payload={payload} onSelect={select} />
      </aside>
      <main key={payload.run.runId} {...stylex.props(styles.main)}>
        {item ? (
          <ReviewItemView conditions={payload.conditions} item={item} />
        ) : (
          <div {...stylex.props(styles.done)}>
            {completionText(counts, payload.verdict).map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        )}
      </main>
      {item && (
        <ReviewBar
          busy={busy}
          error={error}
          inputRef={inputRef}
          item={item}
          note={note}
          onNote={setNote}
          onPass={() => void act('pass')}
          onRework={() => void act('rework')}
        />
      )}
      {panel && <ReworkPanel payload={payload} onClose={() => setPanel(false)} />}
    </div>
  );
};
