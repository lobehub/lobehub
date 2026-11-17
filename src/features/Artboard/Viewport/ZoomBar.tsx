import { type DropdownItem, DropdownMenu, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { isMacOS } from '@/utils/platform';

import { floatStyles } from './floatStyles';
import { formatZoom, type ZoomCommand, zoomCommandFromKey, zoomFactor } from './zoomCommands';

const MOD = isMacOS() ? '⌘' : 'Ctrl';

const HINTS: Record<ZoomCommand, string> = {
  actual: '⇧ 0',
  fit: '⇧ 1',
  in: `${MOD} +`,
  out: `${MOD} −`,
};

const styles = stylex.create({
  bar: {
    insetBlockEnd: 'calc(12px + env(safe-area-inset-bottom, 0px))',
    insetInlineStart: 12,
  },
  hint: {
    color: cssVar.colorTextTertiary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
  },
  value: {
    fontVariantNumeric: 'tabular-nums',
  },
});

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || !!target.closest('input, textarea, select, [contenteditable]'));

interface ZoomBarProps {
  k: number;
  onFit: () => void;
  onZoom: (factor: number) => void;
}

const ZoomBar = ({ k, onFit, onZoom }: ZoomBarProps) => {
  const { t } = useTranslation('project');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const apply = (command: ZoomCommand) =>
      command === 'fit' ? onFit() : onZoom(zoomFactor(command, k));
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isEditable(event.target)) return;
      const command = zoomCommandFromKey(event);
      const root = ref.current?.closest('[data-artboard-root]');
      if (!command || !root) return;
      if (!root.matches(':hover') && !root.contains(document.activeElement)) return;
      event.preventDefault();
      apply(command);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [k, onFit, onZoom]);

  const item = (command: ZoomCommand, label: string): DropdownItem => ({
    extra: <span {...stylex.props(styles.hint)}>{HINTS[command]}</span>,
    key: command,
    label,
    onClick: () => (command === 'fit' ? onFit() : onZoom(zoomFactor(command, k))),
  });

  const items: DropdownItem[] = [
    item('in', t('artboard.zoom.in')),
    item('out', t('artboard.zoom.out')),
    item('fit', t('artboard.zoom.fit')),
    item('actual', t('artboard.zoom.actual')),
  ];

  return (
    <div ref={ref} {...stylex.props(floatStyles.float, floatStyles.bar, styles.bar)}>
      <DropdownMenu items={items} placement={'topLeft'}>
        <div {...stylex.props(floatStyles.trigger)}>
          <span {...stylex.props(styles.value)}>{formatZoom(k)}</span>
          <Icon color={cssVar.colorTextTertiary} icon={ChevronDownIcon} size={14} />
        </div>
      </DropdownMenu>
    </div>
  );
};

export default ZoomBar;
