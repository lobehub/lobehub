'use client';

import type { AcceptanceCommentThread, AcceptanceFrameImage } from '@lobechat/types';
import { Center, Flexbox, Popover, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { MouseEvent, ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { sx } from '@/styles/sx';

import CommentComposer from '../Comments/CommentComposer';
import CommentThread from '../Comments/CommentThread';
import type { useAcceptanceComments } from '../Comments/hooks';
import type { FramePinTarget } from './frameBoard';

const styles = stylex.create({
  frame: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderRadius: 6,
    lineHeight: 0,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  image: {
    display: 'block',
    height: 'auto',
    width: '100%',
  },
  pinning: {
    cursor: 'crosshair',
  },
  /** Clicks inside an iframe never reach this element; in pin mode a sheet takes them instead. */
  catcher: {
    inset: 0,
    position: 'absolute',
    zIndex: 1,
  },
  missing: {
    color: cssVar.colorTextQuaternary,
    fontSize: 12,
    height: 160,
    lineHeight: 1.4,
  },
  pin: {
    alignItems: 'center',
    backgroundColor: cssVar.colorWarning,
    borderColor: '#fff',
    borderTopLeftRadius: '50%',
    borderTopRightRadius: '50%',
    borderBottomRightRadius: '50%',
    borderBottomLeftRadius: '0',
    borderStyle: 'solid',
    borderWidth: 2,
    boxShadow: cssVar.boxShadowSecondary,
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    fontSize: 11,
    fontWeight: 700,
    height: 22,
    justifyContent: 'center',
    lineHeight: 1,
    padding: 0,
    position: 'absolute',
    transform: 'translate(-2px, -20px)',
    width: 22,
    zIndex: 2,
  },
  resolved: {
    backgroundColor: cssVar.colorTextQuaternary,
  },
  draft: {
    backgroundColor: cssVar.colorPrimary,
  },
  panel: {
    maxHeight: 420,
    overflowY: 'auto',
    width: 320,
  },
});

type Comments = ReturnType<typeof useAcceptanceComments>;

interface PinSurfaceProps {
  alt: string;
  /** Live content to pin on, e.g. a Canvas; replaces the image when given. */
  children?: ReactNode;
  comments: Comments;
  frameId: string;
  image?: AcceptanceFrameImage;
  /** Cap the rendered width, e.g. to show a prototype near its designed size. */
  maxWidth?: number;
  /** Pin numbers continue across the frame, so a list can refer to "pin 3". */
  numberOffset?: number;
  pinMode: boolean;
  target: FramePinTarget;
  threads: AcceptanceCommentThread[];
}

/**
 * One board surface — a capture image or a live Canvas — with the comments
 * pinned on it. In pin mode a click drops a marker and opens the composer
 * there; each marker opens its own thread, so a remark always stays attached
 * to the spot it is about.
 */
const PinSurface = ({
  alt,
  children,
  comments,
  frameId,
  image,
  maxWidth,
  numberOffset = 0,
  pinMode,
  target,
  threads,
}: PinSurfaceProps) => {
  const { t } = useTranslation('verify');
  const viewerId = useUserStore(userProfileSelectors.userId);
  const [draft, setDraft] = useState<{ x: number; y: number }>();
  const [openId, setOpenId] = useState<string>();

  const drop = (event: MouseEvent<HTMLDivElement>) => {
    if (!pinMode || !comments.canComment) return;
    if ((event.target as HTMLElement).closest('[data-frame-pin]')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    setOpenId(undefined);
    setDraft({
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    });
  };

  const actions = {
    onDelete: comments.remove,
    onReply: (rootId: string, content: string, attachments: { fileId: string }[]) =>
      comments.create({
        attachments,
        clientId: `${rootId}:${Date.now()}`,
        content,
        parentCommentId: rootId,
      }),
    onResolve: comments.setResolved,
  };

  return (
    <div
      {...sx([styles.frame, pinMode && comments.canComment && styles.pinning], undefined, {
        maxWidth,
      })}
      onClick={drop}
    >
      {children ??
        (image?.fileUrl ? (
          <img
            alt={alt}
            draggable={false}
            height={image.fileHeight ?? undefined}
            src={image.fileUrl}
            width={image.fileWidth ?? undefined}
            {...stylex.props(styles.image)}
          />
        ) : (
          <Center {...stylex.props(styles.missing)}>{t('frames.imageMissing')}</Center>
        ))}
      {children && pinMode && comments.canComment && <div {...stylex.props(styles.catcher)} />}
      {threads.map((thread, index) => {
        const anchor = thread.root.frame;
        if (!anchor || (thread.root.deletedAt && thread.replies.length === 0)) return null;
        const canResolve =
          comments.canApprove ||
          (Boolean(viewerId) && thread.root.authorUserId === viewerId && !thread.root.deletedAt);
        return (
          <Popover
            key={thread.root.id}
            open={openId === thread.root.id}
            placement={'right'}
            trigger={'click'}
            content={
              <div {...stylex.props(styles.panel)}>
                <CommentThread
                  canComment={comments.canComment}
                  canResolve={canResolve}
                  thread={thread}
                  {...actions}
                />
              </div>
            }
            onOpenChange={(open) => setOpenId(open ? thread.root.id : undefined)}
          >
            <button
              data-frame-pin
              aria-label={t('frames.pin.label', { index: numberOffset + index + 1 })}
              type={'button'}
              {...sx([styles.pin, Boolean(thread.root.resolvedAt) && styles.resolved], undefined, {
                left: `${anchor.x * 100}%`,
                top: `${anchor.y * 100}%`,
              })}
            >
              {numberOffset + index + 1}
            </button>
          </Popover>
        );
      })}
      {draft && (
        <Popover
          open
          placement={'right'}
          trigger={'click'}
          content={
            <Flexbox gap={8} {...stylex.props(styles.panel)}>
              <Text fontSize={12} type={'secondary'}>
                {t('frames.pin.newTitle')}
              </Text>
              <CommentComposer
                autoFocus
                placeholder={t('frames.pin.placeholder')}
                submitLabel={t('frames.pin.submit')}
                onCancel={() => setDraft(undefined)}
                onSubmit={async (content, attachments) => {
                  await comments.create({
                    attachments,
                    clientId: crypto.randomUUID(),
                    content,
                    frameAnchor: { frameId, ...target, ...draft },
                  });
                  setDraft(undefined);
                }}
              />
            </Flexbox>
          }
          onOpenChange={(open) => {
            if (!open) setDraft(undefined);
          }}
        >
          <button
            data-frame-pin
            aria-label={t('frames.pin.newTitle')}
            type={'button'}
            {...sx([styles.pin, styles.draft], undefined, {
              left: `${draft.x * 100}%`,
              top: `${draft.y * 100}%`,
            })}
          >
            +
          </button>
        </Popover>
      )}
    </div>
  );
};

export default PinSurface;
