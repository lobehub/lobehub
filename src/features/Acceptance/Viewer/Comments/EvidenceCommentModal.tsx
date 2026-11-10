'use client';

import type { AcceptanceCommentTime, AcceptanceReviewAnnotation } from '@lobechat/types';
import {
  createModal,
  createStaticStyles,
  cssVar,
  cx,
  Flexbox,
  Icon,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
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
import { readVideoCommentDrafts } from './videoCommentDraft';
import { VideoCommentEditor } from './VideoCommentEditor';

const MODAL_WIDTH = 'min(1180px, calc(100vw - 48px))';

const styles = createStaticStyles(({ css }) => ({
  /** A review surface, not a dialog: the evidence needs the room to be circled precisely. */
  popup: css`
    > div {
      display: flex;
      flex-direction: column;

      width: ${MODAL_WIDTH};
      max-width: ${MODAL_WIDTH};
      height: min(860px, calc(100dvh - 48px));
    }

    @media (width <= 767px) {
      align-items: stretch;
      justify-content: stretch;

      width: 100vw !important;
      max-width: 100vw !important;
      height: 100dvh;

      > div {
        width: 100vw !important;
        max-width: 100vw !important;
        height: 100dvh;
        max-height: 100dvh;
        padding: 0;
        border-radius: 0;
      }
    }
  `,
  header: css`
    @media (width <= 767px) {
      min-height: 56px;
      padding-block: max(12px, env(safe-area-inset-top)) 12px;
      padding-inline: 12px 52px;
    }
  `,
  close: css`
    @media (width <= 767px) {
      inset-block-start: max(4px, env(safe-area-inset-top));
      inset-inline-end: 4px;
      width: 44px;
      height: 44px;
    }
  `,
  strip: css`
    overflow-x: auto;
    flex: none;
    gap: 8px;
  `,
  thumb: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;
    flex: none;

    width: 72px;
    height: 44px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillTertiary};

    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 1px;
    }

    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
  thumbActive: css`
    border-color: ${cssVar.colorPrimary};
  `,
  /** A video has no poster to thumbnail without decoding it — an icon tile says what it is. */
  videoThumb: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 100%;
    height: 100%;

    color: #fff;

    background: #000;
  `,
  /** Unsent drafts on another piece of evidence: sending here leaves them where they are. */
  draftCount: css`
    position: absolute;
    inset-block-start: 2px;
    inset-inline-end: 2px;

    min-width: 16px;
    height: 16px;
    padding-inline: 4px;
    border-radius: 8px;

    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
    color: ${cssVar.colorBgContainer};

    background: ${cssVar.colorText};
  `,
}));

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
    <Flexbox horizontal className={styles.strip}>
      {media.map((item, index) => {
        const count = draftCount(userId, options.acceptanceId, item);
        const label = t('acceptance.comments.evidenceNumber', { index: index + 1 });
        return (
          <button
            aria-label={label}
            aria-pressed={item.id === active.id}
            className={cx(styles.thumb, item.id === active.id && styles.thumbActive)}
            disabled={pending}
            key={item.id}
            type={'button'}
            title={
              count > 0 ? `${label} · ${t('acceptance.comments.evidenceDrafts', { count })}` : label
            }
            onClick={() => setActiveId(item.id)}
          >
            {item.type === 'video' ? (
              <span className={styles.videoThumb}>
                <Icon icon={Film} size={18} />
              </span>
            ) : (
              <img alt={''} src={item.fileUrl!} />
            )}
            {count > 0 && <span className={styles.draftCount}>{count}</span>}
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
    classNames: { close: styles.close, header: styles.header, popup: styles.popup },
    footer: null,
    maskClosable: true,
    styles: {
      content: { padding: 0, display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' },
    },
    title: t('acceptance.comments.evidenceModalTitle', { ns: 'verify' }),
    width: MODAL_WIDTH,
  });
