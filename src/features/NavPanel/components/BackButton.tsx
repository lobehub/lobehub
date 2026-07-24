import { type ActionIconProps } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui';
import { ChevronLeftIcon } from 'lucide-react';
import { memo, type MouseEvent } from 'react';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { appNavigate } from '@/features/Electron/navigation/appNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

export const BACK_BUTTON_ID = 'lobe-back-button';

const BackButton = memo<ActionIconProps & { to?: string }>(({ to = '/', onClick, ...rest }) => {
  const activeSlug = useActiveWorkspaceSlug();
  const resolvedTo = buildWorkspaceAwarePath(to, activeSlug);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event as never);
    if (event.defaultPrevented) return;
    // Let the browser handle modifier/middle clicks (open-in-new) — matches the
    // previous <Link> behavior; a plain click stays in-app via the facade.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    appNavigate(resolvedTo, { escape: true });
  };

  return (
    <a href={resolvedTo} onClick={handleClick}>
      <ActionIcon
        icon={ChevronLeftIcon}
        id={BACK_BUTTON_ID}
        size={DESKTOP_HEADER_ICON_SMALL_SIZE}
        {...rest}
      />
    </a>
  );
});

export default BackButton;
