'use client';

import { Button, DropdownMenu } from '@lobehub/ui';
import { Share2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type CanvasVersionDetail } from '@/services/canvas';

import { useCanvasShareItems } from './useCanvasShareItems';

interface CanvasShareButtonProps {
  data: CanvasVersionDetail | null | undefined;
  onShared: () => unknown;
}

/**
 * The canvas toolbar's explicit share affordance. Publishing a canvas and
 * opening its public link both live here, never in the `…` menu — sharing is
 * the primary thing this toolbar offers, so it is a visible button.
 */
const CanvasShareButton = memo<CanvasShareButtonProps>(({ data, onShared }) => {
  const { t } = useTranslation('portal');
  const items = useCanvasShareItems(data, onShared);

  if (items.length === 0) return null;

  return (
    <DropdownMenu items={items} placement={'bottomRight'}>
      <Button icon={Share2} size={'small'} style={{ flex: 'none' }}>
        {t('canvas.share.trigger')}
      </Button>
    </DropdownMenu>
  );
});

CanvasShareButton.displayName = 'CanvasShareButton';

export default CanvasShareButton;
