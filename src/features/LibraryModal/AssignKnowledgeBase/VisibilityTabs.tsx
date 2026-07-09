'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { LockIcon, UsersIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

export type PickerVisibility = 'private' | 'public';

interface VisibilityTabsProps {
  onChange: (value: PickerVisibility) => void;
  value: PickerVisibility;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  button: css`
    cursor: pointer;

    display: inline-flex;
    gap: 6px;
    align-items: center;
    justify-content: center;

    padding-block: 6px;
    padding-inline: 12px;
    border: none;
    border-radius: ${cssVar.borderRadius};

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};

    background: transparent;

    transition: background 0.15s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  buttonActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorBgElevated};
    box-shadow: 0 1px 2px rgb(0 0 0 / 6%);
  `,
  group: css`
    display: inline-flex;
    padding: 3px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
}));

// Mirrors ResourceModeToggle's visual language so the picker feels like the
// same primitive as the sidebar toggle — same iconography, same label copy.
const OPTIONS: Array<{ icon: typeof LockIcon; key: PickerVisibility; labelKey: string }> = [
  { icon: UsersIcon, key: 'public', labelKey: 'resources.visibility.workspace' },
  { icon: LockIcon, key: 'private', labelKey: 'resources.visibility.private' },
];

const VisibilityTabs = memo<VisibilityTabsProps>(({ value, onChange }) => {
  const { t } = useTranslation('chat');

  return (
    <div className={styles.group} role={'tablist'}>
      {OPTIONS.map((option) => {
        const isActive = value === option.key;
        const OptionIcon = option.icon;
        return (
          <button
            aria-selected={isActive}
            className={cx(styles.button, isActive && styles.buttonActive)}
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
