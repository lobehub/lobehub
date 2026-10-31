'use client';

import type {
  AcceptanceCommentThread,
  AcceptanceFrame,
  AcceptanceFrameBoardView,
  AcceptanceFrameOperation,
} from '@lobechat/types';
import { ActionIcon, Button, Center, Flexbox, Icon, Tag, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleAlert, CircleCheck, ImagePlus, Maximize2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openCanvasModal } from '@/features/CanvasModal/loader';
import { useFileStore } from '@/store/file';

import type { useAcceptanceComments } from '../Comments/hooks';
import CanvasReference from './CanvasReference';
import { canvasRefLabel, shownVersionOf, threadsForFrameTarget } from './frameBoard';
import PinSurface from './PinSurface';
import SourceBadge from './SourceBadge';

const styles = stylex.create({
  side: {
    flexBasis: 0,
    flexGrow: 1,
    minWidth: 0,
  },
  placeholder: {
    borderColor: cssVar.colorBorder,
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 1,
    color: cssVar.colorTextTertiary,
    fontSize: 13,
    lineHeight: 1.5,
    minHeight: 220,
    padding: 16,
    textAlign: 'center',
  },
  caption: {
    fontSize: 12,
    fontWeight: 600,
  },
  hidden: {
    display: 'none',
  },
});

interface FrameCompareProps {
  board: AcceptanceFrameBoardView;
  comments: ReturnType<typeof useAcceptanceComments>;
  frame: AcceptanceFrame;
  frameThreads: AcceptanceCommentThread[];
  onUpdate: (operation: AcceptanceFrameOperation) => Promise<boolean>;
  pinMode: boolean;
  previewVersionId?: string;
}

/**
 * One node, in the order it is worked: the Canvas reference on the left comes
 * first and is live from the moment the board is published; the capture of
 * the running product on the right can only land once that reference is
 * locked as the baseline. Until a real capture is attached and judged, the
 * node has not passed delivery — whatever the review concluded about the
 * reference.
 */
const FrameCompare = ({
  board,
  comments,
  frame,
  frameThreads,
  onUpdate,
  pinMode,
  previewVersionId,
}: FrameCompareProps) => {
  const { t } = useTranslation('verify');
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const reference = shownVersionOf(frame, previewVersionId);
  const baseline = frame.baseline ? reference : undefined;
  const capture = frame.captures.at(-1);
  const review = frame.realReview?.captureId === capture?.id ? frame.realReview : undefined;
  const canAttach = board.canEdit && Boolean(baseline);

  const attach = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadWithProgress({ file });
      if (result?.id) await onUpdate({ fileId: result.id, type: 'addCapture' });
    } catch (error) {
      console.error('[acceptance:frames] capture upload failed', error);
      toast.error(t('frames.updateFailed'));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Text strong>{t('frames.compare.title')}</Text>
        {canAttach && (
          <>
            <input
              accept={'image/*'}
              ref={input}
              type={'file'}
              {...stylex.props(styles.hidden)}
              onChange={(event) => void attach(event.target.files?.[0])}
            />
            <Button
              icon={<Icon icon={ImagePlus} />}
              loading={uploading}
              size={'small'}
              onClick={() => input.current?.click()}
            >
              {t('frames.compare.attach')}
            </Button>
          </>
        )}
      </Flexbox>

      <Flexbox horizontal align={'flex-start'} gap={16}>
        <Flexbox gap={8} {...stylex.props(styles.side)}>
          <Flexbox horizontal align={'center'} gap={6}>
            <SourceBadge source={'mock'} />
            <span {...stylex.props(styles.caption)}>
              {t(baseline ? 'frames.compare.prototype' : 'frames.compare.reference')}
              {reference ? ` · ${reference.label}` : ''}
            </span>
            {reference && (
              <>
                <Text ellipsis fontSize={11} type={'secondary'}>
                  {canvasRefLabel(reference)}
                </Text>
                <ActionIcon
                  icon={Maximize2}
                  size={'small'}
                  title={t('frames.reference.open')}
                  onClick={() =>
                    void openCanvasModal(
                      reference.canvasId,
                      reference.canvasVersion,
                      reference.page,
                    )
                  }
                />
              </>
            )}
          </Flexbox>
          {reference && (
            <PinSurface
              alt={`${frame.title} · ${reference.label}`}
              comments={comments}
              frameId={frame.id}
              pinMode={pinMode}
              target={{ versionId: reference.id }}
              threads={threadsForFrameTarget(frameThreads, frame.id, { versionId: reference.id })}
            >
              <CanvasReference version={reference} />
            </PinSurface>
          )}
        </Flexbox>

        <Flexbox gap={8} {...stylex.props(styles.side)}>
          <Flexbox horizontal align={'center'} gap={6}>
            <SourceBadge source={'real'} />
            <span {...stylex.props(styles.caption)}>{t('frames.compare.real')}</span>
            {frame.captures.length > 1 && (
              <Text fontSize={11} type={'secondary'}>
                {t('frames.compare.history', { count: frame.captures.length })}
              </Text>
            )}
          </Flexbox>
          {capture ? (
            <PinSurface
              alt={`${frame.title} · real`}
              comments={comments}
              frameId={frame.id}
              image={board.images[capture.fileId]}
              pinMode={pinMode}
              target={{ captureId: capture.id }}
              threads={threadsForFrameTarget(frameThreads, frame.id, { captureId: capture.id })}
            />
          ) : (
            <Center {...stylex.props(styles.placeholder)}>
              {t(baseline ? 'frames.compare.noReal' : 'frames.compare.needBaseline')}
            </Center>
          )}
          {capture?.note && (
            <Text fontSize={12} type={'secondary'}>
              {capture.note}
            </Text>
          )}
        </Flexbox>
      </Flexbox>

      {capture && (
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          {review ? (
            <>
              <Tag
                color={review.verdict === 'matches' ? 'success' : 'error'}
                icon={<Icon icon={review.verdict === 'matches' ? CircleCheck : CircleAlert} />}
              >
                {t(`frames.compare.verdict.${review.verdict}`)}
              </Tag>
              {board.canEdit && (
                <Button
                  size={'small'}
                  type={'text'}
                  onClick={() => void onUpdate({ type: 'clearRealReview' })}
                >
                  {t('frames.compare.clearVerdict')}
                </Button>
              )}
            </>
          ) : (
            <>
              <Text fontSize={12} type={'secondary'}>
                {t('frames.compare.awaitingVerdict')}
              </Text>
              {board.canEdit && (
                <>
                  <Button
                    icon={<Icon icon={CircleCheck} />}
                    size={'small'}
                    onClick={() => void onUpdate({ type: 'reviewReal', verdict: 'matches' })}
                  >
                    {t('frames.compare.matches')}
                  </Button>
                  <Button
                    danger
                    icon={<Icon icon={CircleAlert} />}
                    size={'small'}
                    onClick={() => void onUpdate({ type: 'reviewReal', verdict: 'deviates' })}
                  >
                    {t('frames.compare.deviates')}
                  </Button>
                </>
              )}
            </>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default FrameCompare;
