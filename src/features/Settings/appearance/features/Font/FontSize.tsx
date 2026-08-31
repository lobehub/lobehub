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
  const options = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const size = index + 12;

        return {
          ariaLabel: `${size}px`,
          label:
            size === 12
              ? 'A'
              : size === 14
                ? t('settingChatAppearance.fontSize.marks.normal')
                : size === 18
                  ? 'A'
                  : ' ',
          style: {
            fontSize: size === 14 ? 14 : size,
            overflowWrap: 'normal' as const,
            whiteSpace: 'nowrap' as const,
          },
          value: size,
        };
      }),
    [t],
  );

  return (
    <Flexbox gap={16} width={'100%'}>
      <DiscreteSlider options={options} value={value} onChange={onChange} />
      <ChatPreview fontSize={value} />
    </Flexbox>
  );
});
