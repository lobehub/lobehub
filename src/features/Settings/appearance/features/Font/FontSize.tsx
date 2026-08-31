'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import DiscreteSlider from '@/components/DiscreteSlider';

import ChatPreview from './ChatPreview';

interface FontSizeControlProps {
  onChange: (value: number) => void;
  value: number;
}

export const FontSizeControl = memo<FontSizeControlProps>(({ onChange, value }) => {
  const { t } = useTranslation('setting');
  const options = useMemo(() => {
    const marks: Record<number, string> = {
      12: 'A',
      14: t('settingChatAppearance.fontSize.marks.normal'),
      18: 'A',
    };

    return Array.from({ length: 7 }, (_, index) => {
      const size = index + 12;

      return {
        ariaLabel: `${size}px`,
        label: marks[size] ?? ' ',
        style: {
          fontSize: size,
          overflowWrap: 'normal' as const,
          whiteSpace: 'nowrap' as const,
        },
        value: size,
      };
    });
  }, [t]);

  return (
    <Flexbox gap={16} width={'100%'}>
      <DiscreteSlider options={options} value={value} onChange={onChange} />
      <ChatPreview fontSize={value} />
    </Flexbox>
  );
});
