'use client';

import { Button, Flexbox, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ImageUpIcon } from 'lucide-react';
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFileStore } from '@/store/file';

import LibraryCover from './index';
import { LIBRARY_COVER_PRESETS, presetCoverValue, resolveLibraryCover } from './presets';

/** Covers are banners, not documents; a larger image only slows every card down. */
const MAX_COVER_SIZE = 5 * 1024 * 1024;

const styles = stylex.create({
  swatch: {
    cursor: 'pointer',
    overflow: 'hidden',
    height: '40px',
    padding: 0,
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: { 'default': 'transparent', ':hover': cssVar.colorBorder },
    borderRadius: cssVar.borderRadius,
    transitionProperty: 'border-color',
    transitionDuration: '0.2s',
    transitionTimingFunction: cssVar.motionEaseInOut,
  },
  swatchActive: {
    borderColor: { 'default': cssVar.colorPrimary, ':hover': cssVar.colorPrimary },
  },
  swatches: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '8px',
  },
});

const swatchProps = (active: boolean, background: string) => {
  const props = stylex.props(styles.swatch, active && styles.swatchActive);
  return { className: props.className, style: { ...props.style, backgroundImage: background } };
};

interface CoverPickerProps {
  /** Stored cover value; empty means the generated default. */
  onChange: (cover: string | null) => void;
  /** Library id (or a draft seed) that picks the default cover. */
  seed: string;
  value?: string | null;
}

/** Choose a library cover: a preset gradient, an uploaded image, or the default. */
const CoverPicker = memo<CoverPickerProps>(({ onChange, seed, value }) => {
  const { t } = useTranslation('file');
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const resolved = resolveLibraryCover(value, seed);
  const activePresetId = value && resolved.kind === 'preset' ? resolved.presetId : null;

  const handleUpload = async (file: File) => {
    if (file.size > MAX_COVER_SIZE) {
      toast.error(t('docs.cover.tooLarge'));
      return;
    }
    setUploading(true);
    try {
      const result = await uploadWithProgress({ file });
      if (!result?.url) {
        toast.error(t('docs.cover.uploadFailed'));
        return;
      }
      onChange(result.url);
    } catch (error) {
      console.error('[CoverPicker] cover upload failed:', error);
      toast.error(t('docs.cover.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Flexbox gap={12}>
      <LibraryCover cover={value} height={72} seed={seed} style={{ borderRadius: 8 }} />
      <div {...stylex.props(styles.swatches)}>
        {LIBRARY_COVER_PRESETS.map((preset) => (
          <button
            aria-label={preset.id}
            key={preset.id}
            {...swatchProps(activePresetId === preset.id, preset.background)}
            type={'button'}
            onClick={() => onChange(presetCoverValue(preset.id))}
          />
        ))}
      </div>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Button
          icon={ImageUpIcon}
          loading={uploading}
          size={'small'}
          onClick={() => inputRef.current?.click()}
        >
          {t('docs.cover.upload')}
        </Button>
        {value ? (
          <Button size={'small'} type={'text'} onClick={() => onChange(null)}>
            {t('docs.cover.reset')}
          </Button>
        ) : (
          <Text fontSize={12} type={'secondary'}>
            {t('docs.cover.defaultHint')}
          </Text>
        )}
      </Flexbox>
      <input
        accept={'image/*'}
        ref={inputRef}
        style={{ display: 'none' }}
        type={'file'}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleUpload(file);
        }}
      />
    </Flexbox>
  );
});

CoverPicker.displayName = 'CoverPicker';

export default CoverPicker;
