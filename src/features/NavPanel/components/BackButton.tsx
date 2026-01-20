import { ActionIcon, type ActionIconProps } from '@lobehub/ui';
import { ChevronLeftIcon } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router-dom';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';

export const BACK_BUTTON_ID = 'lobe-back-button';

const BackButton = memo<ActionIconProps & { to?: string }>(({ to = '/', onClick, ...rest }) => {
  return (
    // @ts-expect-error
    <Link onClick={onClick} to={to}>
      <ActionIcon
        icon={ChevronLeftIcon}
        id={BACK_BUTTON_ID}
        size={DESKTOP_HEADER_ICON_SIZE}
        {...rest}
      />
    </Link>
  );
});

export default BackButton;
