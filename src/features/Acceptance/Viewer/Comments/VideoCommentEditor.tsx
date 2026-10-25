'use client';

import { Icon, Text, toast, useModalContext, useResponsive } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Crosshair } from 'lucide-react';
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSingleton } from '@/hooks/useSingleton';

import type { AcceptanceEvidence } from '../Checks/types';
import {
  VideoEvidencePlayer,
  type VideoEvidencePlayerHandle,
} from '../Evidence/Video/VideoEvidencePlayer';
import { formatVideoTime, frameOf } from '../Evidence/Video/videoTime';
import {
  CommentWorkspace,
  DraftEmpty,
  DraftFooter,
  DraftNote,
  DraftPanelHeading,
  StatusLink,
} from './CommentWorkspace';
import { evidenceCommentDraftKey } from './evidenceCommentDraft';
import type { EvidenceCommentValue } from './EvidenceCommentModal';
import {
  orderVideoCommentDrafts,
  readVideoCommentDrafts,
  saveVideoCommentDrafts,
  sendVideoCommentDrafts,
  type VideoCommentDraft,
} from './videoCommentDraft';

const styles = stylex.create({
  stamp: {
    cursor: 'pointer',
    display: 'inline-flex',
    flex: 'none',
    gap: 4,
    alignItems: 'center',
    height: 22,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: cssVar.borderRadiusSM,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorText,
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillSecondary },
    outline: { 'default': null, ':focus-visible': `2px solid ${cssVar.colorPrimaryBorder}` },
  },
});

interface VideoCommentEditorProps {
  acceptanceId: string;
  active: AcceptanceEvidence;
  initialTime?: number;
  onBusyChange: (busy: boolean) => void;
  onConfirm: (value: EvidenceCommentValue) => Promise<boolean>;
  /** The number of drafts changed — the evidence strip counts them. */
  onDraftsChange: () => void;
  onRefreshEvidenceUrl?: (id: string) => Promise<string | undefined>;
  strip?: ReactNode;
  userId: string;
}

/**
 * Several comments on one recording, written before any is sent. Each circled
 * area is its own note with its own moment and words, numbered in playing
 * order on the frame, the timeline and the list alike. Choosing a note shows
 * its frame; the drafts survive closing and reloading, and a failed send keeps
 * exactly the notes that did not go out.
 */
export const VideoCommentEditor = ({
  acceptanceId,
  active,
  initialTime,
  onBusyChange,
  onConfirm,
  onDraftsChange,
  onRefreshEvidenceUrl,
  strip,
  userId,
}: VideoCommentEditorProps) => {
  const { t } = useTranslation('verify');
  const { md: desktop = true } = useResponsive();
  const { close, setCanDismissByClickOutside } = useModalContext();
  const key = evidenceCommentDraftKey(userId, acceptanceId, active.id);
  const [notes, setNotes] = useState(() => readVideoCommentDrafts(key));
  const current = useRef(notes);
  const [activeId, setActiveId] = useState<string>();
  const [fresh, setFresh] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [unsent, setUnsent] = useState(false);
  const [src, setSrc] = useState(active.fileUrl!);
  const player = useRef<VideoEvidencePlayerHandle>(null);
  const fields = useSingleton(() => new Map<string, HTMLTextAreaElement>());

  const update = (next: VideoCommentDraft[]) => {
    const counted = next.length !== current.current.length;
    current.current = next;
    setNotes(next);
    saveVideoCommentDrafts(key, next);
    if (counted) onDraftsChange();
  };
  const ordered = orderVideoCommentDrafts(notes);
  const numberOf = (id: string) => ordered.findIndex((note) => note.clientId === id) + 1;
  const blocked = ordered.find((note) => !note.content.trim());

  const show = (note: VideoCommentDraft) => {
    setActiveId(note.clientId);
    player.current?.focus(note.time);
  };
  const edit = (note: VideoCommentDraft) => {
    show(note);
    fields.get(note.clientId)?.focus();
  };
  const remove = (note: VideoCommentDraft) => {
    const index = numberOf(note.clientId);
    const position = current.current.findIndex((item) => item.clientId === note.clientId);
    update(current.current.filter((item) => item.clientId !== note.clientId));
    if (activeId === note.clientId) setActiveId(undefined);
    // Words are the part worth getting back; an empty circle costs one drag.
    if (!note.content.trim()) return;
    toast.info({
      actions: [
        {
          label: t('acceptance.comments.undo'),
          onClick: () => {
            if (current.current.some((item) => item.clientId === note.clientId)) return;
            update(current.current.toSpliced(position, 0, note));
            show(note);
          },
        },
      ],
      title: t('acceptance.comments.draftRemoved', { index }),
    });
  };

  const submit = async () => {
    if (submitting || ordered.length === 0) return;
    if (blocked) {
      edit(blocked);
      return;
    }
    setSubmitting(true);
    setUnsent(false);
    onBusyChange(true);
    setCanDismissByClickOutside(false);
    try {
      const done = await sendVideoCommentDrafts(
        orderVideoCommentDrafts(current.current),
        (note) => onConfirm({ ...note, evidenceId: active.id }),
        (id) => update(current.current.filter((note) => note.clientId !== id)),
      );
      if (done) close();
    } catch (cause) {
      console.error('[acceptance:comments]', cause);
      setUnsent(true);
      setActiveId(orderVideoCommentDrafts(current.current)[0]?.clientId);
      toast.error(t('acceptance.comments.createFailed'));
    } finally {
      setSubmitting(false);
      onBusyChange(false);
      setCanDismissByClickOutside(true);
    }
  };

  let status: ReactNode = t('acceptance.comments.draftSaved');
  if (unsent && ordered.length > 0)
    status = t('acceptance.comments.draftsUnsent', { count: ordered.length });
  else if (ordered.length === 0) status = t('acceptance.comments.draftNeedsRegion');
  else if (blocked)
    status = (
      <StatusLink onClick={() => edit(blocked)}>
        {t('acceptance.comments.draftNeedsText', { index: numberOf(blocked.clientId) })}
      </StatusLink>
    );

  return (
    <CommentWorkspace
      inert={submitting}
      stageMode={'fit'}
      strip={strip}
      footer={
        <DraftFooter
          count={ordered.length}
          disabled={ordered.length === 0 || Boolean(blocked)}
          error={unsent && ordered.length > 0}
          loading={submitting}
          status={status}
          onCancel={close}
          onSend={() => void submit()}
        />
      }
      panel={
        <>
          <DraftPanelHeading count={ordered.length} />
          {ordered.length === 0 ? (
            <DraftEmpty body={t('acceptance.comments.video.emptyBody')} />
          ) : (
            ordered.map((note, index) => (
              <DraftNote
                active={note.clientId === activeId}
                autoFocus={desktop && note.clientId === fresh}
                index={index + 1}
                key={note.clientId}
                value={note.content}
                fieldRef={(element) => {
                  if (element) fields.set(note.clientId, element);
                  else fields.delete(note.clientId);
                }}
                stamp={
                  <>
                    <button
                      {...stylex.props(styles.stamp)}
                      type={'button'}
                      aria-label={t('acceptance.comments.video.showFrame', {
                        time: formatVideoTime(note.time.start),
                      })}
                      title={t('acceptance.comments.video.showFrame', {
                        time: formatVideoTime(note.time.start),
                      })}
                      onClick={() => show(note)}
                    >
                      <Icon icon={Crosshair} size={12} />
                      {formatVideoTime(note.time.start)}
                    </button>
                    <Text ellipsis fontSize={12} style={{ color: cssVar.colorTextTertiary }}>
                      {t('acceptance.video.frame', { frame: frameOf(note.time.start) })}
                    </Text>
                  </>
                }
                onRemove={() => remove(note)}
                onSubmit={() => void submit()}
                onChange={(content) =>
                  update(
                    current.current.map((item) =>
                      item.clientId === note.clientId ? { ...item, content } : item,
                    ),
                  )
                }
                onFocus={() => {
                  if (activeId !== note.clientId) show(note);
                }}
              />
            ))
          )}
        </>
      }
      stage={
        <VideoEvidencePlayer
          activeMark={activeId}
          frameMaxHeight={desktop ? 'calc(100cqh - 88px)' : '46svh'}
          handleRef={player}
          initialTime={initialTime ?? ordered[0]?.time.start}
          src={src}
          marks={ordered.map((note, index) => ({
            // A draft is annotation red, like a region being drawn on a screenshot.
            color: cssVar.colorError,
            comment: note.content,
            key: note.clientId,
            label: index + 1,
            rect: note.rect,
            time: note.time,
          }))}
          onMarkClick={(id) => {
            setActiveId(id);
            fields.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }}
          onRefreshSource={async () => {
            const renewed = await onRefreshEvidenceUrl?.(active.id);
            if (renewed) setSrc(renewed);
          }}
          onRegion={(anchor) => {
            const note = { ...anchor, clientId: crypto.randomUUID(), content: '' };
            update([...current.current, note]);
            setActiveId(note.clientId);
            setFresh(note.clientId);
            setUnsent(false);
          }}
        />
      }
    />
  );
};
