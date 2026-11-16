'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { meaningfulEvidenceCaption } from '../../Report/EvidenceComparisonCard';
import { useOptionalAcceptanceScope } from '../AcceptanceScope';
import type { AcceptanceEvidence } from '../Checks/types';
import { commentIdFromHash } from '../Comments/anchor';
import { EvidenceImageStage, type EvidenceStageSize } from './EvidenceImageStage';
import type { EvidenceOverlayMap } from './overlay';

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: 0,
  },
  rootFill: {
    flex: '1',
    minHeight: 0,
  },
  strip: {
    display: 'flex',
    flex: 'none',
    gap: '8px',
    alignItems: 'center',
    minWidth: 0,
  },
  thumbs: {
    overflowX: 'auto',
    display: 'flex',
    flexGrow: '0',
    flexShrink: '1',
    flexBasis: 'auto',
    gap: '8px',
    minWidth: 0,
    padding: '3px',
    margin: '-3px',
  },
  thumb: {
    cursor: 'pointer',
    position: 'relative',
    overflow: 'hidden',
    flex: 'none',
    width: '72px',
    aspectRatio: '16 / 10',
    padding: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadiusSM,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '1px' },
  },
  thumbActive: {
    outlineWidth: { 'default': '2px', ':focus-visible': '2px' },
    outlineStyle: { 'default': 'solid', ':focus-visible': 'solid' },
    outlineColor: { 'default': cssVar.colorPrimary, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': '1px', ':focus-visible': '1px' },
  },
  thumbImage: {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'top',
  },
  thumbCount: {
    position: 'absolute',
    insetBlockStart: '2px',
    insetInlineEnd: '2px',
    minWidth: '16px',
    height: '16px',
    paddingInline: '4px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 600,
    lineHeight: '16px',
    color: cssVar.colorBgContainer,
    backgroundColor: cssVar.colorText,
  },
  caption: {
    overflow: 'hidden',
    flex: '1',
    minWidth: 0,
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextTertiary,
    textAlign: 'end',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  captionAlone: {
    flex: 'none',
    textAlign: 'center',
    whiteSpace: 'normal',
  },
});

interface EvidenceGalleryProps {
  action?: (item: AcceptanceEvidence) => ReactNode;
  items: AcceptanceEvidence[];
  overlays?: EvidenceOverlayMap;
  size?: EvidenceStageSize;
}

const altOf = (item: AcceptanceEvidence) => item.description ?? item.fileName ?? item.type;

export const EvidenceGallery = memo<EvidenceGalleryProps>(({ action, items, overlays, size }) => {
  const { t } = useTranslation('verify');
  const { hash } = useLocation();
  const scope = useOptionalAcceptanceScope();
  const addressed = scope?.embedded ? undefined : commentIdFromHash(hash);
  const addressedId = addressed
    ? items.find((item) =>
        overlays
          ?.get(item.id)
          ?.some((note) => note.threadId === addressed || note.commentIds?.includes(addressed)),
      )?.id
    : undefined;
  const [activeId, setActiveId] = useState(items[0]?.id);
  const [handled, setHandled] = useState<string>();

  if (addressedId && addressed !== handled) {
    setHandled(addressed);
    setActiveId(addressedId);
  }

  const activeIndex = Math.max(
    items.findIndex((item) => item.id === activeId),
    0,
  );
  const active = items[activeIndex];
  if (!active?.fileUrl) return null;

  const description = meaningfulEvidenceCaption(active.description);
  const several = items.length > 1;
  const position = t('acceptance.stage.imagePosition', {
    current: activeIndex + 1,
    total: items.length,
  });

  return (
    <div {...stylex.props(styles.root, size === 'fill' && styles.rootFill)}>
      <EvidenceImageStage
        action={action?.(active)}
        alt={altOf(active)}
        annotations={overlays?.get(active.id)}
        fileHeight={active.fileHeight}
        fileWidth={active.fileWidth}
        key={active.id}
        size={size}
        src={active.fileUrl}
      />
      {several && (
        <div {...stylex.props(styles.strip)}>
          <div {...stylex.props(styles.thumbs)}>
            {items.map((item, index) => {
              const open =
                overlays?.get(item.id)?.filter((note) => note.comment && !note.resolved).length ??
                0;
              return (
                <button
                  aria-pressed={item.id === active.id}
                  key={item.id}
                  type={'button'}
                  aria-label={t('acceptance.review.imageNumber', {
                    current: index + 1,
                    total: items.length,
                  })}
                  title={
                    open > 0 ? t('acceptance.stage.openComments', { count: open }) : altOf(item)
                  }
                  {...stylex.props(styles.thumb, item.id === active.id && styles.thumbActive)}
                  onClick={() => setActiveId(item.id)}
                >
                  <img
                    alt={''}
                    loading={'lazy'}
                    src={item.fileUrl!}
                    {...stylex.props(styles.thumbImage)}
                  />
                  {open > 0 && <span {...stylex.props(styles.thumbCount)}>{open}</span>}
                </button>
              );
            })}
          </div>
          <span {...stylex.props(styles.caption)}>
            {description ? `${position} · ${description}` : position}
          </span>
        </div>
      )}
      {!several && description && (
        <span {...stylex.props(styles.caption, styles.captionAlone)}>{description}</span>
      )}
    </div>
  );
});

EvidenceGallery.displayName = 'AcceptanceEvidenceGallery';
