import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BotIcon, MessageCircleIcon } from 'lucide-react';
import { useEffect, useMemo } from 'react';

import { sx } from '@/styles/sx';

import { DraftCard, ThreadCard } from '../Board/Thread';
import { useBoard } from '../BoardContext';
import { isQuestion, pagePins } from '../data/commentModel';
import { useArtboardComments } from '../data/useArtboardComments';
import { artboardActions, useArtboardStore } from '../store';
import { floatStyles } from './Overlays';
import type { ViewState } from './useViewport';

const PIN = 28;
const CARD_WIDTH = 352;
const CARD_HEIGHT = 380;
const GAP = 12;

const styles = stylex.create({
  card: {
    padding: 0,
    zIndex: 8,
  },
  dot: {
    backgroundColor: cssVar.colorInfo,
    borderColor: cssVar.colorBgContainer,
    borderRadius: '50%',
    borderStyle: 'solid',
    borderWidth: 2,
    height: 10,
    insetBlockStart: -4,
    insetInlineEnd: -4,
    position: 'absolute',
    width: 10,
  },
  pin: {
    alignItems: 'center',
    backgroundColor: cssVar.colorPrimary,
    borderColor: cssVar.colorBgContainer,
    borderTopLeftRadius: '50%',
    borderTopRightRadius: '50%',
    borderBottomRightRadius: '50%',
    borderBottomLeftRadius: '4px',
    borderStyle: 'solid',
    borderWidth: 2,
    boxShadow: cssVar.boxShadowSecondary,
    color: cssVar.colorBgContainer,
    cursor: 'pointer',
    display: 'flex',
    height: PIN,
    justifyContent: 'center',
    position: 'absolute',
    width: PIN,
    zIndex: 7,
  },
  pinActive: {
    outlineColor: cssVar.colorInfo,
    outlineOffset: 2,
    outlineStyle: 'solid',
    outlineWidth: 2,
  },
  pinQuestion: {
    backgroundColor: cssVar.colorWarning,
  },
  pinResolved: {
    backgroundColor: cssVar.colorTextQuaternary,
    boxShadow: 'none',
  },
});

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const cardBox = (x: number, y: number, size: { height: number; width: number }) => {
  const width = Math.min(CARD_WIDTH, size.width - GAP * 2);
  const right = x + PIN + GAP;
  const left = right + width > size.width - GAP ? x - GAP - width : right;
  return {
    left: clamp(left, GAP, Math.max(GAP, size.width - width - GAP)),
    top: clamp(y - PIN, GAP, Math.max(GAP, size.height - CARD_HEIGHT - GAP)),
    width,
  };
};

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
  const active = !!draft || !!openThreadId;

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      artboardActions.openThread(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  const toScreen = (x: number, y: number) => ({ x: x * view.k + view.x, y: y * view.k + view.y });
  const open = pins.find((pin) => pin.thread.id === openThreadId);
  const anchor = open ? toScreen(open.x, open.y) : draft ? toScreen(draft.x, draft.y) : undefined;

  return (
    <>
      {pins.map(({ thread, x, y }) => {
        const resolved = !!thread.resolvedAt;
        const current = thread.id === openThreadId;
        if (resolved && tool !== 'comment' && !current) return null;
        const at = toScreen(x, y);
        const question = isQuestion(thread);
        return (
          <div
            key={thread.id}
            {...sx(
              [
                styles.pin,
                question && styles.pinQuestion,
                resolved && styles.pinResolved,
                current && styles.pinActive,
              ],
              undefined,
              { left: at.x, top: at.y - PIN },
            )}
            onClick={() => artboardActions.openThread(current ? null : thread.id)}
          >
            <Icon icon={question ? BotIcon : MessageCircleIcon} size={14} />
            {thread.unread && <span {...stylex.props(styles.dot)} />}
          </div>
        );
      })}
      {draft && anchor && (
        <div
          {...sx([styles.pin, styles.pinActive], undefined, {
            left: anchor.x,
            top: anchor.y - PIN,
          })}
        >
          <Icon icon={MessageCircleIcon} size={14} />
        </div>
      )}
      {anchor && size && (
        <div
          {...sx([floatStyles.float, styles.card], undefined, cardBox(anchor.x, anchor.y, size))}
        >
          {open ? <ThreadCard thread={open.thread} /> : draft && <DraftCard draft={draft} />}
        </div>
      )}
    </>
  );
};

export default CommentLayer;
