'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { UserCircle } from 'lucide-react';
import { Fragment, memo } from 'react';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import Cell from '@/components/Cell';
import Divider from '@/components/Cell/Divider';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { WorkspaceSettingsTabs } from '@/types/workspaceSettings';

import { useWorkspaceSettingCategory } from './hooks/useCategory';
import { getWorkspaceSettingsTabUrl } from './hooks/useSettingsSearchScope';

const styles = stylex.create({
  groupTitle: {
    color: cssVar.colorTextSecondary,
    fontSize: 12,
    fontWeight: 500,
    paddingBlockStart: '16px',
    paddingBlockEnd: '4px',
    paddingInline: 16,
  },
});

/**
 * Mobile `/:workspaceSlug/settings`: the desktop settings sidebar as a list.
 * It reads the same category hook, so the permission and lab gates that hide a
 * tab on desktop hide it here too.
 */
const MobileWorkspaceSettingCategory = memo(() => {
  const groups = useWorkspaceSettingCategory();
  const navigate = useWorkspaceAwareNavigate();
  const slug = useActiveWorkspaceSlug();

  // Only mounted under `/:workspaceSlug/settings`; same guard as the desktop sidebar.
  if (!slug) return null;

  return (
    <>
      {groups.map((group, groupIndex) => (
        <Fragment key={group.key}>
          {groupIndex > 0 && <Divider />}
          <div {...stylex.props(styles.groupTitle)}>{group.title}</div>
          {group.items.map((item) => (
            <Cell
              // The profile row carries the user's avatar (or nothing); cells take icon components.
              icon={item.key === WorkspaceSettingsTabs.Profile ? UserCircle : item.icon}
              key={item.key}
              label={item.label}
              // Same URL builder as the desktop sidebar and settings search.
              onClick={() => navigate(getWorkspaceSettingsTabUrl(slug, item.key))}
            />
          ))}
        </Fragment>
      ))}
    </>
  );
});

MobileWorkspaceSettingCategory.displayName = 'MobileWorkspaceSettingCategory';

export default MobileWorkspaceSettingCategory;
