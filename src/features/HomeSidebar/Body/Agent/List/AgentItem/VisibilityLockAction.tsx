import { ActionIcon, type DropdownItem, DropdownMenu } from '@lobehub/ui';
import { LockIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface VisibilityLockActionProps {
  options: DropdownItem[];
}

/**
 * The row's lock, as a door rather than a badge: on hover it sits beside the
 * "…" trigger and opens the same Private / Workspace choice as the menu's
 * Visibility row, so the scope can be changed without scrolling the menu.
 */
const VisibilityLockAction = memo<VisibilityLockActionProps>(({ options }) => {
  const { t } = useTranslation('chat');

  return (
    <DropdownMenu items={options}>
      <ActionIcon
        aria-label={t('agent.visibility.change')}
        data-testid="sidebar-visibility-lock"
        icon={LockIcon}
        size={'small'}
        title={t('agent.visibility.change')}
      />
    </DropdownMenu>
  );
});

VisibilityLockAction.displayName = 'VisibilityLockAction';

export default VisibilityLockAction;
