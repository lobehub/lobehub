'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowUpRightIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

const styles = stylex.create({
  link: {
    display: 'inline-flex',
    gap: '2px',
    alignItems: 'center',
    alignSelf: 'flex-start',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
  },
});

/**
 * Where subscriptions are managed. `WorkspaceLink` adds the active workspace's
 * prefix, so the link opens `/settings/automations` or
 * `/:slug/settings/automations` to match where the conversation lives (契约 3.7).
 */
const ManageLink = memo(() => {
  const { t } = useTranslation('plugin');

  return (
    <WorkspaceLink to={'/settings/automations'} {...stylex.props(styles.link)}>
      {t('builtins.lobe-mcp-events.render.manage')}
      <Icon icon={ArrowUpRightIcon} size={12} />
    </WorkspaceLink>
  );
});

ManageLink.displayName = 'McpEventsManageLink';

export default ManageLink;
