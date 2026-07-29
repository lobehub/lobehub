'use client';

import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { LockIcon, UsersIcon } from 'lucide-react';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import type { ResourceListVisibilityFilter } from '@/routes/(main)/resource/features/store/initialState';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    button: css`
      cursor: pointer;

      display: inline-flex;
      flex: 1;
      gap: 6px;
      align-items: center;
      justify-content: center;

      padding-block: 6px;
      padding-inline: 8px;
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

      width: 100%;
      padding: 3px;
      border-radius: ${cssVar.borderRadiusLG};

      background: ${cssVar.colorFillQuaternary};
    `,
  };
});

const OPTIONS: Array<{
  icon: typeof LockIcon;
  key: ResourceListVisibilityFilter;
  labelKey: string;
  tooltipKey: string;
}> = [
  {
    icon: LockIcon,
    key: 'private',
    labelKey: 'resources.visibility.private',
    tooltipKey: 'resources.mode.privateHint',
  },
  {
    icon: UsersIcon,
    key: 'workspace',
    labelKey: 'resources.visibility.workspace',
    tooltipKey: 'resources.mode.workspaceHint',
  },
];

/**
 * Sidebar-top dual toggle: `[🔒 Private] [👥 Workspace]`.
 *
 * Rendered only in team-workspace mode — personal mode has no notion of
 * visibility, so the toggle is meaningless there and is deliberately hidden.
 * Selecting a mode drives both the list filter (via `listVisibility`) and the
 * upload default (via `useTopLevelFileUpload`), so a single click switches
 * both what the user sees and where the next upload lands.
 */
const ResourceModeToggle = memo(() => {
  const { t } = useTranslation('chat');
  const activeWorkspaceId = useActiveWorkspaceId();
  const [listVisibility, setListVisibility, hydrateListVisibility] = useResourceManagerStore(
    (s) => [s.listVisibility, s.setListVisibility, s.hydrateListVisibility],
  );

  const workspaceId = activeWorkspaceId ?? undefined;

  // Rehydrate from localStorage whenever the active workspace changes, so
  // switching workspaces (or coming back after a reload) restores the mode
  // this user last used in *this* workspace. Personal mode falls through to
  // the initialState default.
  useEffect(() => {
    hydrateListVisibility(workspaceId);
  }, [workspaceId, hydrateListVisibility]);

  if (!workspaceId) return null;

  return (
    <Flexbox paddingBlock={6} paddingInline={4}>
      <div className={styles.group} role={'tablist'}>
        {OPTIONS.map((option) => {
          const isActive = listVisibility === option.key;
          const OptionIcon = option.icon;
          const label = t(option.labelKey as never);
          return (
            <Tooltip key={option.key} title={t(option.tooltipKey as never)}>
              <button
                aria-selected={isActive}
                className={cx(styles.button, isActive && styles.buttonActive)}
                role={'tab'}
                type={'button'}
                onClick={() => {
                  if (isActive) return;
                  setListVisibility(option.key, workspaceId);
                }}
              >
                <Icon icon={OptionIcon} size={14} />
                <span>{label}</span>
              </button>
            </Tooltip>
          );
        })}
      </div>
    </Flexbox>
  );
});

ResourceModeToggle.displayName = 'ResourceModeToggle';

export default ResourceModeToggle;
