'use client';

import { Button, cssVar, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { ChevronDownIcon, Share2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type CanvasVersionDetail } from '@/services/canvas';

import { useCanvasShareTrigger } from './useCanvasShareItems';

interface CanvasShareButtonProps {
  data: CanvasVersionDetail | null | undefined;
  onShared: () => unknown;
}

const triggerStyle = { flex: 'none', paddingInline: 5 } as const;

/**
 * The canvas toolbar's explicit share affordance. Publishing a canvas and
 * opening its public link both live here, never in the `…` menu — sharing is
 * the primary thing this toolbar offers, so it keeps a glyph of its own.
 *
 * The ghost glyph only becomes a menu when there is something to choose
 * between: with a single action the click goes straight to it (a fresh canvas
 * opens the publish confirm modal) and an arrow would promise a list holding
 * one row. Once sharing and opening the public link both apply, the menu is
 * real and says so with a chevron, the way the version switcher does.
 */
const CanvasShareButton = memo<CanvasShareButtonProps>(({ data, onShared }) => {
  const { t } = useTranslation('portal');
  const trigger = useCanvasShareTrigger(data, onShared);

  if (trigger.kind === 'none') return null;

  if (trigger.kind === 'action') {
    const { action } = trigger;

    return (
      <Button
        aria-label={action.label}
        disabled={action.disabled}
        size={'small'}
        style={triggerStyle}
        title={action.label}
        type={'text'}
        onClick={action.onClick}
      >
        <Icon color={cssVar.colorIcon} icon={Share2} size={'small'} />
      </Button>
    );
  }

  const label = t('canvas.share.trigger');

  return (
    <DropdownMenu items={trigger.items} placement={'bottomRight'}>
      <Button aria-label={label} size={'small'} style={triggerStyle} title={label} type={'text'}>
        <Flexbox horizontal align={'center'} gap={2}>
          <Icon color={cssVar.colorIcon} icon={Share2} size={'small'} />
          <Icon color={cssVar.colorIcon} icon={ChevronDownIcon} size={12} />
        </Flexbox>
      </Button>
    </DropdownMenu>
  );
});

CanvasShareButton.displayName = 'CanvasShareButton';

export default CanvasShareButton;
