'use client';

import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import { Flexbox, TextArea } from '@lobehub/ui';
import { Button, createModal, Text, toast, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AcceptanceEvidence } from '../Checks/types';
import { AnnotationCanvas } from '../Evidence/Annotation';
import { isAnnotatable } from '../Evidence/evidence';

const styles = createStaticStyles(({ css }) => ({
  hint: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  stage: css`
    overflow: auto;

    max-height: min(60vh, 640px);
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorFillQuaternary};
  `,
  thumb: css`
    cursor: pointer;

    overflow: hidden;

    width: 64px;
    height: 44px;
    border: 2px solid transparent;
    border-radius: 6px;

    background: ${cssVar.colorFillTertiary};

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
  thumbActive: css`
    border-color: ${cssVar.colorPrimary};
  `,
}));

export interface EvidenceCommentValue {
  content: string;
  evidenceId: string;
  rect: AcceptanceReviewAnnotation['rect'];
}

interface EvidenceCommentModalProps {
  evidence: AcceptanceEvidence[];
  initialEvidenceId?: string;
  /** Persist the comment; resolve true to close, false to stay open. */
  onConfirm: (value: EvidenceCommentValue) => Promise<boolean>;
}

/**
 * Circle one spot on one screenshot and say what is wrong with it. One region
 * per comment on purpose: a thread is about a place, and two places are two
 * threads.
 */
const EvidenceCommentContent = memo<EvidenceCommentModalProps>(
  ({ evidence, initialEvidenceId, onConfirm }) => {
    const { t } = useTranslation('verify');
    const { close } = useModalContext();
    const images = evidence.filter(isAnnotatable);
    const [activeId, setActiveId] = useState(initialEvidenceId ?? images[0]?.id);
    const [rect, setRect] = useState<AcceptanceReviewAnnotation['rect'] | null>(null);
    const [content, setContent] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const active = images.find((item) => item.id === activeId) ?? images[0];
    const trimmed = content.trim();

    const submit = async () => {
      if (!active || !rect || !trimmed || submitting) return;
      setSubmitting(true);
      try {
        const done = await onConfirm({ content: trimmed, evidenceId: active.id, rect });
        if (done) close();
      } catch (cause) {
        console.error('[acceptance:comments]', cause);
        toast.error(t('acceptance.comments.createFailed'));
      } finally {
        setSubmitting(false);
      }
    };

    if (!active) return null;

    return (
      <Flexbox gap={12} padding={16}>
        <span className={styles.hint}>{t('acceptance.comments.regionHint')}</span>
        {images.length > 1 && (
          <Flexbox horizontal gap={8} wrap={'wrap'}>
            {images.map((item) => (
              <div
                aria-pressed={item.id === active.id}
                className={cx(styles.thumb, item.id === active.id && styles.thumbActive)}
                key={item.id}
                role={'button'}
                onClick={() => {
                  setActiveId(item.id);
                  setRect(null);
                }}
              >
                <img alt={item.description ?? item.type} src={item.fileUrl!} />
              </div>
            ))}
          </Flexbox>
        )}
        <div className={styles.stage}>
          <AnnotationCanvas
            annotations={rect ? [{ comment: '', rect }] : []}
            src={active.fileUrl!}
            onDraw={setRect}
            onRemove={() => setRect(null)}
            onUpdate={(_index, next) => setRect(next)}
          />
        </div>
        <TextArea
          autoFocus
          autoSize={{ maxRows: 6, minRows: 2 }}
          placeholder={t('acceptance.comments.placeholder')}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
          {!rect && (
            <Text fontSize={12} type={'secondary'}>
              {t('acceptance.comments.regionMissing')}
            </Text>
          )}
          <Button
            disabled={!rect || !trimmed}
            loading={submitting}
            type={'primary'}
            onClick={() => void submit()}
          >
            {t('acceptance.comments.send')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

EvidenceCommentContent.displayName = 'AcceptanceEvidenceCommentContent';

export const openEvidenceCommentModal = (options: EvidenceCommentModalProps) =>
  createModal({
    content: <EvidenceCommentContent {...options} />,
    footer: null,
    maskClosable: true,
    styles: { content: { padding: 0 } },
    title: t('acceptance.comments.regionModalTitle', { ns: 'verify' }),
    width: 'min(880px, 92vw)',
  });
