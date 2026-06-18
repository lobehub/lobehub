import { type ActionIconProps } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui';
import { ChevronLeftIcon } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router-dom';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

export const BACK_BUTTON_ID = 'lobe-back-button';

const BackButton = memo<ActionIconProps & { to?: string }>(({ to = '/', onClick, ...rest }) => {
  const activeSlug = useActiveWorkspaceSlug();
  const resolvedTo = buildWorkspaceAwarePath(to, activeSlug);

  return (
    // @ts-expect-error
    <Link to={resolvedTo} onClick={onClick}>
      <ActionIcon
        icon={ChevronLeftIcon}
        id={BACK_BUTTON_ID}
        size={DESKTOP_HEADER_ICON_SMALL_SIZE}
        {...rest}
      />
    </Link>
  );
});

export default BackButton;
