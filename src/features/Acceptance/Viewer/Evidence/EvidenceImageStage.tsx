'use client';

import { Button, Icon, Image } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, MoveHorizontal, MoveVertical } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { useOptionalAcceptanceScope } from '../AcceptanceScope';
import { commentAnchorId } from '../Comments/anchor';
import { floatingActionHostMarker } from '../markers.stylex';
import { AnnotationFace, OverlayNoteContent, OverlayRect } from './EvidenceOverlays';
import { type EvidenceOverlay, overlayColor } from './overlay';
import { resolveStageFit, stageContentBox, type StageSize } from './stageFit';
import { useImageThreads } from './useImageThreads';
import { useMeasuredWidth } from './useMeasuredWidth';

export type EvidenceStageSize = 'capped' | 'fill';

const STAGE_PADDING = { bottom: 16, left: 16, right: 16, top: 16 };

const styles = stylex.create({
  root: {
    position: 'relative',
    overflow: 'hidden',
    flex: 'none',
    width: '100%',
    height: 'min(480px, 70dvh)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '12px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  rootFill: {
    flex: '1',
    height: 'auto',
    minHeight: '240px',
  },
  viewport: {
    position: 'absolute',
    insetBlock: 0,
    insetInline: 0,
    overflow: 'auto',
    display: 'flex',
    padding: '16px',
  },
  imageBox: {
    position: 'relative',
    flex: 'none',
    margin: 'auto',
    borderRadius: cssVar.borderRadius,
    boxShadow: `0 0 0 1px ${cssVar.colorBorder}`,
  },
  pendingBox: {
    display: 'flex',
    maxWidth: '100%',
    maxHeight: '100%',
    margin: 'auto',
  },
  clip: {
    overflow: 'hidden',
    width: '100%',
    height: '100%',
    borderRadius: cssVar.borderRadius,
  },
  fade: {
    pointerEvents: 'none',
    position: 'absolute',
    insetBlockEnd: 0,
    insetInline: 0,
    height: '56px',
    backgroundImage: `linear-gradient(to bottom, transparent, ${cssVar.colorBgContainer})`,
  },
  toggle: {
    position: 'absolute',
    zIndex: 3,
    insetBlockEnd: '12px',
    insetInlineEnd: '12px',
  },
  note: {
    position: 'absolute',
    zIndex: 5,
    insetBlockStart: '12px',
    insetInlineEnd: '12px',
    overflowY: 'auto',
    width: 'min(280px, calc(100% - 24px))',
    maxHeight: 'calc(100% - 24px)',
    padding: '12px',
    paddingInlineEnd: '32px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowSecondary,
  },
  pin: {
    cursor: 'pointer',
    position: 'absolute',
    zIndex: 4,
    insetInlineEnd: '-14px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderStyle: 'none',
    borderTopLeftRadius: '50%',
    borderTopRightRadius: '50%',
    borderBottomRightRadius: '50%',
    borderBottomLeftRadius: '2px',
    color: cssVar.colorTextLightSolid,
    boxShadow: cssVar.boxShadowTertiary,
    filter: { 'default': null, ':hover': 'brightness(1.12)' },
  },
});

interface EvidenceImageStageProps {
  action?: ReactNode;
  alt: string;
  annotations?: EvidenceOverlay[];
  fileHeight?: number | null;
  fileWidth?: number | null;
  size?: EvidenceStageSize;
  src: string;
}

export const EvidenceImageStage = memo<EvidenceImageStageProps>(
  ({ action, alt, annotations, fileHeight, fileWidth, size = 'capped', src }) => {
    const { t } = useTranslation('verify');
    const { height, ref, width } = useMeasuredWidth<HTMLDivElement>();
    const [loaded, setLoaded] = useState<StageSize>();
    const [fitHeight, setFitHeight] = useState(false);
    const scope = useOptionalAcceptanceScope();
    const { openedNote, toggleNote, close } = useImageThreads(annotations, scope?.embedded);

    const natural = fileWidth && fileHeight ? { height: fileHeight, width: fileWidth } : loaded;
    const fit = resolveStageFit({
      fitHeight,
      natural,
      stage: stageContentBox({ height, width }, STAGE_PADDING),
    });
    const numbered =
      (annotations?.length ?? 0) > 1 || annotations?.some((item) => item.label !== undefined);
    const opened = openedNote === undefined ? undefined : annotations?.[openedNote];

    return (
      <div
        {...stylex.props(
          styles.root,
          size === 'fill' && styles.rootFill,
          action ? floatingActionHostMarker : null,
        )}
      >
        <div ref={ref} {...stylex.props(styles.viewport)}>
          {fit ? (
            // Regions and pins hang off the image box, never the stage: the
            // side bands change with every layout, the picture's own box does not.
            <div {...sx(styles.imageBox, { height: fit.height, width: fit.width })}>
              <div {...stylex.props(styles.clip)}>
                <Image
                  alt={alt}
                  height={'100%'}
                  loading={'lazy'}
                  maxHeight={'none'}
                  maxWidth={'none'}
                  objectFit={'contain'}
                  src={src}
                  style={{ borderRadius: 0, height: '100%', width: '100%' }}
                  variant={'borderless'}
                  width={'100%'}
                  styles={{
                    image: { height: '100%', width: '100%' },
                    wrapper: { height: '100%', width: '100%' },
                  }}
                />
              </div>
              {annotations?.map((annotation, index) => (
                <OverlayRect
                  annotation={annotation}
                  index={index}
                  key={index}
                  numbered={Boolean(numbered)}
                  opened={openedNote === index}
                  rect={annotation.rect}
                  onToggle={toggleNote}
                />
              ))}
              {openedNote === undefined &&
                annotations?.map((annotation, index) =>
                  annotation.comment ? (
                    <button
                      key={index}
                      title={annotation.authorName}
                      type={'button'}
                      {...sx(styles.pin, {
                        background: overlayColor(annotation),
                        insetBlockStart: `${Math.min(Math.max(annotation.rect.y, 0), 0.86) * 100}%`,
                      })}
                      onClick={() => toggleNote(index)}
                    >
                      {annotation.resolved ? (
                        <Icon icon={Check} size={12} />
                      ) : (
                        <AnnotationFace
                          name={annotation.authorName}
                          src={annotation.authorAvatar}
                        />
                      )}
                    </button>
                  ) : null,
                )}
            </div>
          ) : (
            <div {...stylex.props(styles.pendingBox)}>
              <Image
                alt={alt}
                loading={'lazy'}
                objectFit={'contain'}
                src={src}
                style={{ borderRadius: 0, maxHeight: '100%', maxWidth: '100%' }}
                variant={'borderless'}
                onLoad={(event) =>
                  setLoaded({
                    height: event.currentTarget.naturalHeight,
                    width: event.currentTarget.naturalWidth,
                  })
                }
              />
            </div>
          )}
        </div>
        {fit?.mode === 'scroll' && <span {...stylex.props(styles.fade)} />}
        {opened && (
          <div
            id={opened.threadId ? commentAnchorId(opened.threadId) : undefined}
            {...stylex.props(styles.note)}
          >
            <OverlayNoteContent
              label={numbered ? (opened.label ?? openedNote! + 1) : undefined}
              opened={opened}
              onClose={close}
            />
          </div>
        )}
        {action}
        {fit?.tall && (
          <Button
            icon={<Icon icon={fitHeight ? MoveHorizontal : MoveVertical} />}
            size={'small'}
            {...stylex.props(styles.toggle)}
            onClick={() => setFitHeight((value) => !value)}
          >
            {t(fitHeight ? 'acceptance.stage.fitWidth' : 'acceptance.stage.fitHeight')}
          </Button>
        )}
      </div>
    );
  },
);

EvidenceImageStage.displayName = 'AcceptanceEvidenceImageStage';
