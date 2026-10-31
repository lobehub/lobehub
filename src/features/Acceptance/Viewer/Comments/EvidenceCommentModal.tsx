'use client';

import type { AcceptanceCommentTime, AcceptanceReviewAnnotation } from '@lobechat/types';
import { createModal, Flexbox, Icon, Text, toast, useModalContext } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t } from 'i18next';
import { Film } from 'lucide-react';
import type { ReactNode } from 'react';
import { useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import type { AcceptanceEvidence } from '../Checks/types';
import { AnnotationCanvas } from '../Evidence/Annotation';
import { isCommentableEvidence } from '../Evidence/evidence';
import {
  CommentWorkspace,
  DraftEmpty,
  DraftFooter,
  DraftNote,
  DraftPanelHeading,
} from './CommentWorkspace';
import type { EvidenceCommentDraft } from './evidenceCommentDraft';
import {
  evidenceCommentDraftKey,
  readEvidenceCommentDraft,
  saveEvidenceCommentDraft,
} from './evidenceCommentDraft';
import moduleStyles from './EvidenceCommentModal.module.css';
import { readVideoCommentDrafts } from './videoCommentDraft';
import { VideoCommentEditor } from './VideoCommentEditor';

const MODAL_WIDTH = 'min(1180px, calc(100vw - 48px))';

// The popup's chrome lives in EvidenceCommentModal.module.css, which repeats MODAL_WIDTH.
const phone = '@media (width <= 767px)';

const styles = stylex.create({
  header: {
    minHeight: { default: null, [phone]: '56px' },
    paddingBlockStart: { default: null, [phone]: 'max(12px, env(safe-area-inset-top))' },
    paddingBlockEnd: { default: null, [phone]: '12px' },
    paddingInlineStart: { default: null, [phone]: '12px' },
    paddingInlineEnd: { default: null, [phone]: '52px' },
  },
  close: {
    insetBlockStart: { default: null, [phone]: 'max(4px, env(safe-area-inset-top))' },
    insetInlineEnd: { default: null, [phone]: '4px' },
    width: { default: null, [phone]: '44px' },
    height: { default: null, [phone]: '44px' },
  },
  strip: {
    overflowX: 'auto',
    flex: 'none',
    gap: '8px',
  },
  thumb: {
    cursor: { 'default': 'pointer', ':disabled': 'not-allowed' },
    position: 'relative',
    overflow: 'hidden',
    flex: 'none',
    width: '72px',
    height: '44px',
    padding: 0,
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
    opacity: { 'default': null, ':disabled': 0.5 },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '1px' },
  },
  thumbImage: {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  thumbActive: {
    borderColor: cssVar.colorPrimary,
  },
  // A video has no poster to thumbnail without decoding it — an icon tile says what it is.
  videoThumb: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    color: '#fff',
    backgroundColor: '#000',
    backgroundImage: 'none',
  },
  // Unsent drafts on another piece of evidence: sending here leaves them where they are.
  draftCount: {
    position: 'absolute',
    insetBlockStart: '2px',
    insetInlineEnd: '2px',
    minWidth: '16px',
    height: '16px',
    paddingInline: '4px',
    borderRadius: '8px',
    fontSize: '11px',
    fontWeight: 600,
    lineHeight: '16px',
    color: cssVar.colorBgContainer,
    backgroundColor: cssVar.colorText,
  },
});

export interface EvidenceCommentValue {
  clientId: string;
  content: string;
  evidenceId: string;
  rect: AcceptanceReviewAnnotation['rect'];
  time?: AcceptanceCommentTime;
}

interface EvidenceCommentModalProps {
  acceptanceId: string;
  evidence: AcceptanceEvidence[];
  initialEvidenceId?: string;
  initialTime?: number;
  /** Persist the comment; resolve true to close, false to stay open. */
  onConfirm: (value: EvidenceCommentValue) => Promise<boolean>;
  onRefreshEvidenceUrl?: (id: string) => Promise<string | undefined>;
}

interface EditorProps extends EvidenceCommentModalProps {
  active: AcceptanceEvidence;
  onBusyChange: (busy: boolean) => void;
  onDraftsChange: () => void;
  strip?: ReactNode;
  userId: string;
}

/**
 * An image comment points at one region. Video editing owns its multi-frame drafts.
 * Its anchor stays fixed until explicitly changed; submission never reviews a check.
 */
const ImageCommentEditor = ({
  acceptanceId,
  active,
  onConfirm,
  onBusyChange,
  onDraftsChange,
  strip,
  userId,
}: EditorProps) => {
  const { t } = useTranslation('verify');
  const { close, setCanDismissByClickOutside } = useModalContext();
  const key = evidenceCommentDraftKey(userId, acceptanceId, active.id);
  const [draft, setDraft] = useState<EvidenceCommentDraft>(
    () =>
      readEvidenceCommentDraft(key) ?? {
        clientId: crypto.randomUUID(),
        content: '',
        rect: null,
      },
  );
  const current = useRef(draft);
  const update = (patch: Partial<EvidenceCommentDraft>) => {
    const next = { ...current.current, ...patch };
    const counted = Boolean(next.rect) !== Boolean(current.current.rect);
    current.current = next;
    setDraft(next);
    saveEvidenceCommentDraft(key, next);
    if (counted) onDraftsChange();
  };
  const [submitting, setSubmitting] = useState(false);
  const { rect, content, clientId } = draft;
  const trimmed = content.trim();
  const submit = async () => {
    if (!rect || !trimmed || submitting) return;
    setSubmitting(true);
    onBusyChange(true);
    try {
      setCanDismissByClickOutside(false);
      const done = await onConfirm({
        clientId,
        content: trimmed,
        evidenceId: active.id,
        rect,
      });
      if (done) {
        saveEvidenceCommentDraft(key);
        close();
      }
    } catch (cause) {
      console.error('[acceptance:comments]', cause);
      toast.error(t('acceptance.comments.createFailed'));
    } finally {
      setSubmitting(false);
      onBusyChange(false);
      setCanDismissByClickOutside(true);
    }
  };

  let status: string = t('acceptance.comments.draftSaved');
  if (!rect) status = t('acceptance.comments.draftNeedsRegion');
  else if (!trimmed) status = t('acceptance.comments.draftNeedsText', { index: 1 });

  return (
    <CommentWorkspace
      inert={submitting}
      stageMode={'scroll'}
      strip={strip}
      footer={
        <DraftFooter
          count={rect ? 1 : 0}
          disabled={!rect || !trimmed}
          loading={submitting}
          status={status}
          onCancel={close}
          onSend={() => void submit()}
        />
      }
      panel={
        <>
          <DraftPanelHeading count={rect ? 1 : 0} />
          {rect ? (
            <DraftNote
              active
              autoFocus
              index={1}
              value={content}
              stamp={
                <Text fontSize={12} type={'secondary'}>
                  {t('acceptance.comments.region')}
                </Text>
              }
              onChange={(value) => update({ content: value })}
              onRemove={() => update({ rect: null })}
              onSubmit={() => void submit()}
            />
          ) : (
            <DraftEmpty body={t('acceptance.comments.regionHint')} />
          )}
        </>
      }
      stage={
        <AnnotationCanvas
          annotations={rect ? [{ comment: '', rect }] : []}
          src={active.fileUrl!}
          onDraw={(next) => update({ rect: next })}
          onRemove={() => update({ rect: null })}
          onUpdate={(_index, next) => update({ rect: next })}
        />
      }
    />
  );
};

/** What is still unsent on a piece of evidence, as its tile in the strip counts it. */
const draftCount = (userId: string, acceptanceId: string, item: AcceptanceEvidence) => {
  const key = evidenceCommentDraftKey(userId, acceptanceId, item.id);
  if (item.type === 'video') return readVideoCommentDrafts(key).length;
  return readEvidenceCommentDraft(key)?.rect ? 1 : 0;
};

const EvidenceCommentContent = (options: EvidenceCommentModalProps) => {
  const userId = useUserStore(userProfileSelectors.userId);
  const { t } = useTranslation('verify');
  const media = options.evidence.filter(isCommentableEvidence);
  const [pending, setPending] = useState(false);
  const [activeId, setActiveId] = useState(options.initialEvidenceId ?? media[0]?.id);
  // Drafts live in storage; this re-reads the counts when an editor adds or drops one.
  const [, recount] = useReducer((value: number) => value + 1, 0);
  const active = media.find((item) => item.id === activeId) ?? media[0];
  if (!active || !userId) return null;

  const strip = media.length > 1 && (
    <Flexbox horizontal {...stylex.props(styles.strip)}>
      {media.map((item, index) => {
        const count = draftCount(userId, options.acceptanceId, item);
        const label = t('acceptance.comments.evidenceNumber', { index: index + 1 });
        return (
          <button
            aria-label={label}
            aria-pressed={item.id === active.id}
            disabled={pending}
            key={item.id}
            type={'button'}
            {...stylex.props(styles.thumb, item.id === active.id && styles.thumbActive)}
            title={
              count > 0 ? `${label} · ${t('acceptance.comments.evidenceDrafts', { count })}` : label
            }
            onClick={() => setActiveId(item.id)}
          >
            {item.type === 'video' ? (
              <span {...stylex.props(styles.videoThumb)}>
                <Icon icon={Film} size={18} />
              </span>
            ) : (
              <img alt={''} src={item.fileUrl!} {...stylex.props(styles.thumbImage)} />
            )}
            {count > 0 && <span {...stylex.props(styles.draftCount)}>{count}</span>}
          </button>
        );
      })}
    </Flexbox>
  );
  const editorProps = {
    ...options,
    active,
    // A later evidence opens at its own start, not at the moment captured on another.
    initialTime: active.id === options.initialEvidenceId ? options.initialTime : undefined,
    onBusyChange: setPending,
    onDraftsChange: recount,
    strip: strip || undefined,
    userId,
  };
  const editorKey = `${active.id}:${userId}`;
  return active.type === 'video' ? (
    <VideoCommentEditor key={editorKey} {...editorProps} />
  ) : (
    <ImageCommentEditor key={editorKey} {...editorProps} />
  );
};

export const openEvidenceCommentModal = (options: EvidenceCommentModalProps) =>
  createModal({
    content: <EvidenceCommentContent {...options} />,
    classNames: {
      close: stylex.props(styles.close).className,
      header: stylex.props(styles.header).className,
      popup: moduleStyles.popup,
    },
    footer: null,
    maskClosable: true,
    styles: {
      content: { padding: 0, display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' },
    },
    title: t('acceptance.comments.evidenceModalTitle', { ns: 'verify' }),
    width: MODAL_WIDTH,
  });
