import { useEffect, useMemo, useRef } from 'react';

import { useBoard } from '../BoardContext';
import CommentPopover from '../Comments/CommentPopover';
import DraftCard from '../Comments/DraftCard';
import { pinTone, threadNumbers } from '../Comments/layout';
import Pin from '../Comments/Pin';
import ThreadCard from '../Comments/ThreadCard';
import { pagePins } from '../data/commentModel';
import { useArtboardComments } from '../data/useArtboardComments';
import { artboardActions, useArtboardStore } from '../store';
import { ownsEscape } from './escapeScope';
import type { ViewState } from './useViewport';

const close = () => artboardActions.openThread(null);

interface CommentLayerProps {
  size: { height: number; width: number } | undefined;
  view: ViewState;
}

const CommentLayer = ({ size, view }: CommentLayerProps) => {
  const board = useBoard();
  const { data: threads } = useArtboardComments(board.artboard.id);
  const { draft, openThreadId, tool } = useArtboardStore((s) => ({
    draft: s.draft,
    openThreadId: s.openThreadId,
    tool: s.tool,
  }));
  const pins = useMemo(() => pagePins(threads ?? [], board), [threads, board]);
  const numbers = useMemo(() => threadNumbers(threads ?? []), [threads]);
  const open = pins.find((pin) => pin.thread.id === openThreadId);
  const active = !!draft || !!open;
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const root = marker.current?.closest('[data-artboard-root]') ?? null;
      if (!ownsEscape(event, root)) return;
      event.stopImmediatePropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  const toScreen = (x: number, y: number) => ({ x: x * view.k + view.x, y: y * view.k + view.y });
  const anchor = open ? toScreen(open.x, open.y) : draft ? toScreen(draft.x, draft.y) : undefined;

  return (
    <>
      <span hidden ref={marker} />
      {pins.map(({ thread, x, y }) => {
        const current = thread.id === openThreadId;
        if (thread.resolvedAt && tool !== 'comment' && !current) return null;
        const number = numbers.get(thread.id);
        return (
          <Pin
            at={toScreen(x, y)}
            key={thread.id}
            label={number ? `#${number}` : undefined}
            number={number}
            open={current}
            tone={pinTone(thread)}
            unsent={thread.unread}
            onClick={() => artboardActions.openThread(current ? null : thread.id)}
          />
        );
      })}
      {draft && anchor && <Pin open at={anchor} />}
      {anchor && size && (
        <CommentPopover anchor={anchor} size={size}>
          {open ? (
            <ThreadCard number={numbers.get(open.thread.id)} thread={open.thread} onClose={close} />
          ) : (
            draft && <DraftCard draft={draft} />
          )}
        </CommentPopover>
      )}
    </>
  );
};

export default CommentLayer;
