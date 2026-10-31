'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { LockIcon, UsersIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

export type PickerVisibility = 'private' | 'public';

interface VisibilityTabsProps {
  onChange: (value: PickerVisibility) => void;
  value: PickerVisibility;
}

const styles = stylex.create({
  button: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: '6px',
    paddingInline: '12px',
    borderStyle: 'none',
    borderRadius: cssVar.borderRadius,
    fontSize: '13px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: 'background 0.15s',
  },
  buttonActive: {
    color: cssVar.colorText,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: '0 1px 2px rgb(0 0 0 / 6%)',
  },
  group: {
    display: 'inline-flex',
    padding: '3px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
});

// Mirrors ResourceModeToggle's visual language so the picker feels like the
// same primitive as the sidebar toggle — same iconography, same label copy.
const OPTIONS: Array<{ icon: typeof LockIcon; key: PickerVisibility; labelKey: string }> = [
  { icon: UsersIcon, key: 'public', labelKey: 'resources.visibility.workspace' },
  { icon: LockIcon, key: 'private', labelKey: 'resources.visibility.private' },
];

const VisibilityTabs = memo<VisibilityTabsProps>(({ value, onChange }) => {
  const { t } = useTranslation('chat');

  return (
    <div {...stylex.props(styles.group)} role={'tablist'}>
      {OPTIONS.map((option) => {
        const isActive = value === option.key;
        const OptionIcon = option.icon;
        return (
          <button
            aria-selected={isActive}
            {...stylex.props(styles.button, isActive && styles.buttonActive)}
            key={option.key}
            role={'tab'}
            type={'button'}
            onClick={() => {
              if (isActive) return;
              onChange(option.key);
            }}
          >
            <Icon icon={OptionIcon} size={14} />
            <span>{t(option.labelKey as never)}</span>
          </button>
        );
      })}
    </div>
  );
});

VisibilityTabs.displayName = 'VisibilityTabs';

export default VisibilityTabs;
