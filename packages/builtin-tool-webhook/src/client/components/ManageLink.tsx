'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowUpRightIcon } from 'lucide-react';
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
 * The agent's Webhook page, where webhooks are managed and keys issued. `WorkspaceLink` adds the
 * active workspace's prefix, so it opens in the scope the conversation lives in.
 */
const ManageLink = ({ agentId }: { agentId: string }) => {
  const { t } = useTranslation('plugin');

  return (
    <WorkspaceLink to={`/agent/${agentId}/webhook`} {...stylex.props(styles.link)}>
      {t('builtins.lobe-webhook.render.manage')}
      <Icon icon={ArrowUpRightIcon} size={12} />
    </WorkspaceLink>
  );
};

export default ManageLink;
