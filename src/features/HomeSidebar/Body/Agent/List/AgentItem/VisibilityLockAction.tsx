import { ActionIcon } from '@lobehub/ui';
import { LockIcon } from 'lucide-react';
import { memo, type MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

interface VisibilityLockActionProps {
  agentId: string;
}

/**
 * The row's lock, as a door rather than a badge: on hover it sits beside the
 * "…" trigger and opens the Agent's Permissions settings, where the scope is
 * changed — the same place the row menu's settings shortcut leads.
 */
const VisibilityLockAction = memo<VisibilityLockActionProps>(({ agentId }) => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();

  const handleClick = useCallback(
    (event: MouseEvent) => {
      // The row is a link to the chat; the lock goes to settings instead.
      event.preventDefault();
      event.stopPropagation();
      navigate(`/agent/${agentId}/permission`);
    },
    [agentId, navigate],
  );

  return (
    <ActionIcon
      aria-label={t('agent.visibility.change')}
      data-testid="sidebar-visibility-lock"
      icon={LockIcon}
      size={'small'}
      title={t('agent.visibility.change')}
      onClick={handleClick}
    />
  );
});

VisibilityLockAction.displayName = 'VisibilityLockAction';

export default VisibilityLockAction;
