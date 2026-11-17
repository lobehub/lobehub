import { Button, Empty, ScrollArea, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchReview, postReview, type ReviewPayload } from '../api';
import { completionText, hasRenderedDifference, keyAction, nextSelection } from '../review';
import { PageState } from './PageState';
import { ReviewBar } from './ReviewBar';
import { ReviewItemView } from './ReviewItemView';
import { ReviewProgress } from './ReviewProgress';
import { ReviewQueue } from './ReviewQueue';
import { ReworkPanel } from './ReworkPanel';
import { useFollowRun } from './RunBadge';
import { TopBar } from './TopBar';

const styles = stylex.create({
  content: { maxWidth: 1440, paddingBlock: 24, paddingInline: 32 },
  layout: { display: 'grid', flex: '1', gridTemplateColumns: '288px minmax(0, 1fr)', minHeight: 0 },
  main: { display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 },
  page: {
    backgroundColor: cssVar.colorBgLayout,
    color: cssVar.colorText,
    display: 'flex',
    flexDirection: 'column',
    fontVariantNumeric: 'tabular-nums',
    height: '100vh',
  },
  queue: {
    backgroundColor: cssVar.colorBgContainer,
    borderInlineEndColor: cssVar.colorBorderSecondary,
    borderInlineEndStyle: 'solid',
    borderInlineEndWidth: 1,
    height: '100%',
    minHeight: 0,
  },
  scroll: { flex: '1', minHeight: 0, overflowY: 'auto' },
});

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(target.tagName);

const inDialog = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest('[role="dialog"]'));

export const ReviewPage = ({ initialKey }: { initialKey?: string }) => {
  const [payload, setPayload] = useState<ReviewPayload>();
  const [current, setCurrent] = useState<string | undefined>(initialKey);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'pass' | 'rework'>();
  const [error, setError] = useState<string>();
  const [panel, setPanel] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    scrollRef.current?.scrollTo({ top: 0 });
  }, []);

  const act = useCallback(
    async (action: 'pass' | 'rework') => {
      if (!item || busy) return;
      const needsNote =
        action === 'rework' ? !hasRenderedDifference(item) : item.category === 'difference';
      if (needsNote && !note.trim()) return void inputRef.current?.focus();
      setBusy(action);
      try {
        const next = await postReview({ action, key: item.key, note });
        setPayload(next);
        select(nextSelection(next.items, item.key));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy(undefined);
      }
    },
    [busy, item, note, select],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!payload || event.metaKey || event.ctrlKey || event.altKey) return;
      const action = keyAction(event.key, isTyping(event.target), panel || inDialog(event.target));
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
  }, [act, current, item, panel, payload, select]);

  if (!payload)
    return (
      <PageState
        error={error}
        loading="正在读取复查队列…"
        title="读取复查队列失败"
        onRetry={() => {
          setError(undefined);
          load();
        }}
      />
    );
  const index = payload.items.findIndex((entry) => entry.key === current);
  return (
    <div {...stylex.props(styles.page)}>
      <TopBar
        base={payload.run.base}
        follow={payload.follow}
        head={payload.run.head}
        section="review"
      />
      <ReviewProgress payload={payload} onOpenReworked={() => setPanel(true)} />
      <div {...stylex.props(styles.layout)}>
        <aside aria-label="复查队列" {...stylex.props(styles.queue)}>
          <ScrollArea disableContentFit style={{ height: '100%' }}>
            <ReviewQueue current={current} payload={payload} onSelect={select} />
          </ScrollArea>
        </aside>
        <main key={payload.run.runId} {...stylex.props(styles.main)}>
          <div ref={scrollRef} {...stylex.props(styles.scroll)}>
            <div {...stylex.props(styles.content)}>
              {item ? (
                <ReviewItemView conditions={payload.conditions} item={item} />
              ) : (
                <Empty
                  icon={CheckCheck}
                  title={completionText(payload.counts, payload.verdict)[0]}
                  type="page"
                  action={
                    payload.counts.reworked > 0 && (
                      <Button onClick={() => setPanel(true)}>查看打回的项</Button>
                    )
                  }
                  description={completionText(payload.counts, payload.verdict)
                    .slice(1)
                    .map((line) => (
                      <Text as="p" key={line} type="secondary">
                        {line}
                      </Text>
                    ))}
                />
              )}
            </div>
          </div>
          {item && (
            <ReviewBar
              busy={busy}
              error={error}
              inputRef={inputRef}
              item={item}
              note={note}
              position={`第 ${index + 1} / ${payload.items.length} 条`}
              onNote={setNote}
              onPass={() => void act('pass')}
              onRework={() => void act('rework')}
            />
          )}
        </main>
      </div>
      <ReworkPanel open={panel} payload={payload} onClose={() => setPanel(false)} />
    </div>
  );
};
