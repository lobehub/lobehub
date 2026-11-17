import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { ScanIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { floatStyles } from './floatStyles';

interface ZoomBarProps {
  k: number;
  onFit: () => void;
  onZoom: (factor: number) => void;
}

const ZoomBar = ({ k, onFit, onZoom }: ZoomBarProps) => {
  const { t } = useTranslation('project');
  return (
    <Flexbox
      horizontal
      align="center"
      gap={2}

      {...sx(floatStyles.float, {
        insetBlockEnd: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        insetInlineStart: 12,
      })}
    >
      <ActionIcon
        icon={ZoomOutIcon}
        size={'small'}
        title={t('artboard.zoom.out')}
        onClick={() => onZoom(1 / 1.25)}
      />
      <Text
        style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', textAlign: 'center', width: 44 }}
      >
        {Math.round(k * 100)}%
      </Text>
      <ActionIcon
        icon={ZoomInIcon}
        size={'small'}
        title={t('artboard.zoom.in')}
        onClick={() => onZoom(1.25)}
      />
      <ActionIcon icon={ScanIcon} size={'small'} title={t('artboard.zoom.fit')} onClick={onFit} />
    </Flexbox>
  );
};

export default ZoomBar;
