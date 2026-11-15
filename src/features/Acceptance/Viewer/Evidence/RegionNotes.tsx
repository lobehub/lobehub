'use client';

import { ActionIcon, Flexbox, TextArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DraftAnnotationEntry, RejectableEvidence } from '../Review/rejectDraft';
import { regionLocations } from './regionLocation';

// iOS Safari zooms the page when a focused field is smaller than 16px.
const TOUCH_FONT_SIZE = 16;
const TOUCH_REMOVE_SIZE = { blockSize: 44, size: 16 };
const TOUCH_REMOVE_STYLE = { marginBlockStart: -6, marginInlineEnd: -8 };

const styles = stylex.create({
  caption: {
    paddingInlineStart: '28px',
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  index: {
    flex: 'none',
    width: '20px',
    height: '20px',
    marginBlockStart: '6px',
    borderRadius: '50%',
    fontSize: '12px',
    fontWeight: 600,
    lineHeight: '20px',
    color: '#fff',
    textAlign: 'center',
    backgroundColor: cssVar.colorError,
    backgroundImage: 'none',
  },
  jump: {
    'cursor': 'pointer',
    'position': 'relative',
    'appearance': 'none',
    'padding': 0,
    'borderWidth': 0,
    'borderStyle': 'none',
    'fontFamily': 'inherit',
    'opacity': { 'default': null, ':active': 0.6 },
    // The badge stays 20px to match the one drawn on the image; the tap target does not.
    '::before': {
      content: '""',
      position: 'absolute',
      insetBlock: '-12px',
      insetInlineStart: '-12px',
      insetInlineEnd: '-4px',
    },
  },
});

interface RegionNoteRowProps {
  autoFocus?: boolean;
  badge: ReactNode;
  caption?: ReactNode;
  index: number;
  onChange: (comment: string) => void;
  onRemove: () => void;
  placeholder: string;
  touch?: boolean;
  value: string;
}

export const RegionNoteRow = memo<RegionNoteRowProps>(
  ({ autoFocus, badge, caption, index, placeholder, touch, value, onChange, onRemove }) => {
    const { t } = useTranslation('verify');
    const fontSize = touch ? TOUCH_FONT_SIZE : undefined;
    const removeLabel = t('acceptance.review.removeRegion', { index });

    return (
      <Flexbox gap={4}>
        {caption}
        <Flexbox horizontal align={'flex-start'} gap={8}>
          {badge}
          <TextArea
            aria-label={t('acceptance.review.annotationPlaceholder', { index })}
            autoFocus={autoFocus}
            autoSize={{ maxRows: 5, minRows: 1 }}
            placeholder={placeholder}
            style={{ flex: 1, fontSize }}
            styles={fontSize ? { input: { fontSize } } : undefined}
            value={value}
            variant={'filled'}
            onChange={(event) => onChange(event.target.value)}
          />
          <ActionIcon
            aria-label={removeLabel}
            icon={X}
            size={touch ? TOUCH_REMOVE_SIZE : 'small'}
            style={touch ? TOUCH_REMOVE_STYLE : undefined}
            title={touch ? undefined : removeLabel}
            onClick={onRemove}
          />
        </Flexbox>
      </Flexbox>
    );
  },
);

RegionNoteRow.displayName = 'AcceptanceRegionNoteRow';

interface RegionNotesProps {
  annotations: DraftAnnotationEntry[];
  onChange: (key: number, comment: string) => void;
  onRemove: (key: number) => void;
}

export const RegionNotes = memo<RegionNotesProps>(({ annotations, onChange, onRemove }) => {
  const { t } = useTranslation('verify');

  return annotations.map((annotation, index) => (
    <RegionNoteRow
      autoFocus={index === annotations.length - 1 && !annotation.comment}
      badge={<span {...stylex.props(styles.index)}>{index + 1}</span>}
      index={index + 1}
      key={annotation.key}
      placeholder={t('acceptance.review.annotationPlaceholder', { index: index + 1 })}
      value={annotation.comment}
      onChange={(comment) => onChange(annotation.key, comment)}
      onRemove={() => onRemove(annotation.key)}
    />
  ));
});

RegionNotes.displayName = 'AcceptanceRegionNotes';

interface MobileRegionNotesProps extends RegionNotesProps {
  evidence: RejectableEvidence[];
  onJump: (evidenceId: string) => void;
}

export const MobileRegionNotes = memo<MobileRegionNotesProps>(
  ({ annotations, evidence, onChange, onJump, onRemove }) => {
    const { t } = useTranslation('verify');
    // Badges restart at 1 on every image, like the ones drawn on it, so with
    // several images the number alone no longer says which region a row is.
    const multipleImages = evidence.length > 1;

    const locations = regionLocations(
      annotations,
      evidence.map((item) => item.id),
    );

    return annotations.map((annotation, index) => {
      const { image, region } = locations[index];
      const location = t('acceptance.review.regionImage', { image, region });

      return (
        <RegionNoteRow
          touch
          caption={multipleImages && <div {...stylex.props(styles.caption)}>{location}</div>}
          index={index + 1}
          key={annotation.key}
          placeholder={t('acceptance.review.rejectPlaceholder')}
          value={annotation.comment}
          badge={
            <button
              {...stylex.props(styles.index, styles.jump)}
              aria-label={location}
              type={'button'}
              onClick={() => onJump(annotation.evidenceId)}
            >
              {region}
            </button>
          }
          onChange={(comment) => onChange(annotation.key, comment)}
          onRemove={() => onRemove(annotation.key)}
        />
      );
    });
  },
);

MobileRegionNotes.displayName = 'AcceptanceMobileRegionNotes';
