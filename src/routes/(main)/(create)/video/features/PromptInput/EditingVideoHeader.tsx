'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { VideoIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  preview: css`
    overflow: hidden;

    width: 64px;
    min-width: 64px;
    height: 40px;
    border-radius: 6px;

    background: ${cssVar.colorFillSecondary};
    box-shadow: 0 0 0 1px ${cssVar.colorBorderSecondary} inset;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
}));

interface EditingVideoHeaderProps {
  coverUrl?: string;
  onCancel: () => void;
  prompt?: string;
}

const EditingVideoHeader = memo<EditingVideoHeaderProps>(({ coverUrl, prompt, onCancel }) => {
  const { t } = useTranslation('video');

  return (
    <Flexbox horizontal align={'center'} gap={10} padding={'8px 12px'}>
      <Block
        horizontal
        align={'center'}
        className={styles.preview}
        justify={'center'}
        variant={'filled'}
      >
        {coverUrl ? <img alt="" src={coverUrl} /> : <VideoIcon size={18} />}
      </Block>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text fontSize={13} weight={500}>
          {t('generation.editing.description')}
        </Text>
        {prompt && (
          <Text ellipsis fontSize={12} type={'secondary'}>
            {prompt}
          </Text>
        )}
      </Flexbox>
      <Button size={'small'} type={'text'} onClick={onCancel}>
        {t('generation.actions.cancelEdit')}
      </Button>
    </Flexbox>
  );
});

EditingVideoHeader.displayName = 'EditingVideoHeader';

export default EditingVideoHeader;
