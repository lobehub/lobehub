'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRightIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  chevron: { display: 'flex', transition: 'transform 150ms ease' },
  chevronOpen: { transform: 'rotate(90deg)' },
  toggle: {
    cursor: 'pointer',

    display: 'flex',
    gap: '4px',
    alignItems: 'center',

    width: '100%',
    paddingBlock: '4px',
    paddingInline: '8px',
    borderStyle: 'none',

    fontSize: '12px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorTextSecondary },
    textAlign: 'start',

    backgroundColor: 'transparent',
  },
});

interface OfflineDevicesToggleProps {
  count: number;
  expanded: boolean;
  onToggle: () => void;
}

/** The folded "Offline (n)" header every device picker puts its offline devices under. */
export const OfflineDevicesToggle = memo<OfflineDevicesToggleProps>(
  ({ count, expanded, onToggle }) => {
    const { t } = useTranslation('device');

    return (
      <button
        aria-expanded={expanded}
        type={'button'}
        {...stylex.props(styles.toggle)}
        // Inside a select popup a press must not reach the list, which would close it.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }}
      >
        <span {...stylex.props(styles.chevron, expanded && styles.chevronOpen)}>
          <Icon icon={ChevronRightIcon} size={12} />
        </span>
        {t('picker.offlineGroup', { count })}
      </button>
    );
  },
);

OfflineDevicesToggle.displayName = 'OfflineDevicesToggle';
