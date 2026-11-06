'use client';

import { ActionIcon, Flexbox, Image, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { LocateFixedIcon, SquarePenIcon, VideoIcon, XIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { editingPreviewMarker } from './markers.stylex';

const styles = stylex.create({
  container: {
    marginBlockEnd: '4px',
    paddingBlock: '8px',
    paddingInline: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  locate: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: cssVar.colorTextLightSolid,
    opacity: { default: 0, [stylex.when.ancestor(':hover', editingPreviewMarker)]: 1 },
    backgroundColor: cssVar.colorBgMask,
    backgroundImage: 'none',
    transition: `opacity 0.15s ${cssVar.motionEaseInOut}`,
  },
  preview: {
    cursor: 'pointer',
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '72px',
    height: '44px',
    borderRadius: '6px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
    boxShadow: `0 0 0 2px ${cssVar.colorPrimary}`,
  },
  title: { color: cssVar.colorPrimary },
});

interface EditingVideoHeaderProps {
  coverUrl?: string;
  onCancel: () => void;
  onLocate: () => void;
  prompt?: string;
  version: number;
}

const EditingVideoHeader = memo<EditingVideoHeaderProps>(
  ({ coverUrl, prompt, version, onCancel, onLocate }) => {
    const { t } = useTranslation('video');

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.container).className}
        gap={12}
      >
        <div
          {...stylex.props(editingPreviewMarker, styles.preview)}
          role={'button'}
          // `role="button"` alone leaves it unreachable: it has to take focus and
          // answer Enter / Space the way a real button does.
          tabIndex={0}
          title={t('generation.version.locateSource')}
          onClick={onLocate}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onLocate();
          }}
        >
          {coverUrl ? (
            <Image
              alt=""
              preview={false}
              src={coverUrl}
              style={{ height: '100%', objectFit: 'cover', width: '100%' }}
            />
          ) : (
            <VideoIcon size={18} />
          )}
          <span {...stylex.props(styles.locate)}>
            <LocateFixedIcon size={16} />
          </span>
        </div>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.title).className}
            gap={6}
          >
            <SquarePenIcon size={14} />
            <Text fontSize={13} style={{ color: 'inherit' }} weight={500}>
              {t('generation.editing.title', { version: String(version) })}
            </Text>
          </Flexbox>
          <Text ellipsis fontSize={12} title={prompt} type={'secondary'}>
            {prompt || t('generation.editing.hint')}
          </Text>
        </Flexbox>
        <ActionIcon
          icon={XIcon}
          size={'small'}
          title={t('generation.editing.cancelHint')}
          onClick={onCancel}
        />
      </Flexbox>
    );
  },
);

EditingVideoHeader.displayName = 'EditingVideoHeader';

export default EditingVideoHeader;
