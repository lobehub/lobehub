'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { UserCircle } from 'lucide-react';
import { Fragment, isValidElement, memo } from 'react';

import Cell from '@/components/Cell';
import Divider from '@/components/Cell/Divider';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { useWorkspaceSettingCategory } from './hooks/useCategory';

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

  return (
    <>
      {groups.map((group, groupIndex) => (
        <Fragment key={group.key}>
          {groupIndex > 0 && <Divider />}
          <div {...stylex.props(styles.groupTitle)}>{group.title}</div>
          {group.items.map((item) => (
            <Cell
              // The profile row carries the user's avatar element; cells take icon components.
              icon={isValidElement(item.icon) ? UserCircle : item.icon}
              key={item.key}
              label={item.label}
              onClick={() => navigate(`/settings/${item.key}`)}
            />
          ))}
        </Fragment>
      ))}
    </>
  );
});

MobileWorkspaceSettingCategory.displayName = 'MobileWorkspaceSettingCategory';

export default MobileWorkspaceSettingCategory;
