'use client';

import { Flexbox, TextArea } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { truncateByWeightedLength } from '@/utils/textLength';

export interface TitleSectionProps {
  onTitleChange?: (title: string) => void;
  title?: string;
}

const TitleSection = memo<TitleSectionProps>(({ title: titleProp, onTitleChange }) => {
  const { t } = useTranslation('file');

  const isTitleControlled = titleProp !== undefined;

  const [innerTitle, setInnerTitle] = useState('');

  const title = isTitleControlled ? titleProp : innerTitle;

  const setTitle = (value: string) => {
    if (!isTitleControlled) setInnerTitle(value);
    onTitleChange?.(value);
  };

  return (
    <Flexbox
      gap={16}
      paddingBlock={16}
      style={{ cursor: 'default' }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <TextArea
        autoSize={{ minRows: 1 }}
        placeholder={t('pageEditor.titlePlaceholder')}
        value={title}
        variant={'borderless'}
        style={{
          fontSize: 36,
          fontWeight: 600,
          padding: 0,
          resize: 'none',
          width: '100%',
        }}
        onChange={(e) => {
          const truncated = truncateByWeightedLength(e.target.value, 100);
          setTitle(truncated);
        }}
      />
    </Flexbox>
  );
});

TitleSection.displayName = 'TopicCanvasTitleSection';

export default TitleSection;
