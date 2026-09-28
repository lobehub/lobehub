'use client';

import { Flexbox, Icon, TextArea } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Crosshair, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DraftAnnotationEntry, RejectableEvidence } from '../Review/rejectDraft';

const styles = createStaticStyles(({ css }) => ({
  /** The badge that ties a note back to the numbered box on the image. */
  index: css`
    flex: none;

    width: 18px;
    height: 18px;
    border-radius: 50%;

    font-size: 11px;
    font-weight: 600;
    line-height: 18px;
    color: #fff;
    text-align: center;

    background: ${cssVar.colorError};
  `,
  /** The phone caption: a link back to the box on the image, not a
      button-shaped box. The tap target comes from padding around a compact
      line, so a list of regions does not become a column of 44px slabs. */
  jump: css`
    cursor: pointer;

    display: inline-flex;
    gap: 5px;
    align-items: center;
    align-self: flex-start;

    padding-block: 7px;
    padding-inline: 2px;
    border: none;

    font-size: 13px;
    color: ${cssVar.colorLink};

    background: none;

    &:active {
      opacity: 0.6;
    }
  `,
}));

interface RegionNoteRowProps {
  /** Rendered beside the field — the desktop's number badge. */
  badge?: ReactNode;
  /** Rendered above the field — the phone's jump-back link. */
  caption?: ReactNode;
  /** 16px on a phone, so focusing the field never zooms the page. */
  fontSize?: number;
  /** 1-based, for the accessible name and the remove label. */
  index: number;
  onChange: (comment: string) => void;
  onRemove: () => void;
  placeholder: string;
  value: string;
}

const RegionNoteRow = memo<RegionNoteRowProps>(
  ({ badge, caption, fontSize, index, placeholder, value, onChange, onRemove }) => {
    const { t } = useTranslation('verify');

    return (
      <Flexbox gap={4}>
        {caption}
        <Flexbox horizontal align={'flex-start'} gap={8}>
          {badge}
          <TextArea
            aria-label={t('acceptance.review.annotationPlaceholder', { index })}
            autoSize={{ maxRows: 5, minRows: 1 }}
            placeholder={placeholder}
            style={{ flex: 1, fontSize }}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          <ActionIcon
            aria-label={t('acceptance.review.removeRegion', { index })}
            icon={Trash2}
            size={{ blockSize: 44, size: 18 }}
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

/** Notes for the regions on the image currently on screen (desktop side panel). */
export const RegionNotes = memo<RegionNotesProps>(({ annotations, onChange, onRemove }) => {
  const { t } = useTranslation('verify');

  return annotations.map((annotation, index) => (
    <RegionNoteRow
      index={index + 1}
      key={annotation.key}
      placeholder={t('acceptance.review.annotationPlaceholder', { index: index + 1 })}
      value={annotation.comment}
      badge={
        <span className={styles.index} style={{ marginBlockStart: 6 }}>
          {index + 1}
        </span>
      }
      onChange={(comment) => onChange(annotation.key, comment)}
      onRemove={() => onRemove(annotation.key)}
    />
  ));
});

RegionNotes.displayName = 'AcceptanceRegionNotes';

interface MobileRegionNotesProps extends RegionNotesProps {
  evidence: RejectableEvidence[];
  /** Show the region's image and put the reviewer back in marking mode. */
  onJump: (evidenceId: string) => void;
}

/**
 * Every region across every image, in one list under the phone's stage.
 *
 * A phone has no side panel to park the other images' notes in, so each row
 * says which image and region it belongs to and links back to it.
 */
export const MobileRegionNotes = memo<MobileRegionNotesProps>(
  ({ annotations, evidence, onChange, onJump, onRemove }) => {
    const { t } = useTranslation('verify');

    return annotations.map((annotation, index) => {
      const imageIndex = evidence.findIndex((item) => item.id === annotation.evidenceId);
      const regionIndex = annotations
        .filter((item) => item.evidenceId === annotation.evidenceId)
        .findIndex((item) => item.key === annotation.key);

      return (
        <RegionNoteRow
          fontSize={16}
          index={index + 1}
          key={annotation.key}
          placeholder={t('acceptance.review.rejectPlaceholder')}
          value={annotation.comment}
          caption={
            <button
              className={styles.jump}
              type={'button'}
              onClick={() => onJump(annotation.evidenceId)}
            >
              <Icon icon={Crosshair} size={13} />
              {t('acceptance.review.regionImage', {
                image: imageIndex + 1,
                region: regionIndex + 1,
              })}
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
