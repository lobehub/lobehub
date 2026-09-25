'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { LocateFixedIcon, SquarePenIcon, VideoIcon, XIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    margin-block-end: 4px;
    padding-block: 8px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  locate: css`
    position: absolute;
    inset: 0;

    display: flex;
    align-items: center;
    justify-content: center;

    color: ${cssVar.colorTextLightSolid};

    opacity: 0;
    background: ${cssVar.colorBgMask};

    transition: opacity 0.15s ${cssVar.motionEaseInOut};
  `,
  preview: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 72px;
    height: 44px;
    border-radius: 6px;

    background: ${cssVar.colorFillSecondary};
    box-shadow: 0 0 0 2px ${cssVar.colorPrimary};

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    &:hover > span {
      opacity: 1;
    }
  `,
  title: css`
    color: ${cssVar.colorPrimary};
  `,
}));

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
      <Flexbox horizontal align={'center'} className={styles.container} gap={12}>
        <div
          className={styles.preview}
          role={'button'}
          title={t('generation.version.locateSource')}
          onClick={onLocate}
        >
          {coverUrl ? <img alt="" src={coverUrl} /> : <VideoIcon size={18} />}
          <span className={styles.locate}>
            <LocateFixedIcon size={16} />
          </span>
        </div>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'center'} className={styles.title} gap={6}>
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
