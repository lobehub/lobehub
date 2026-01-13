import { ActionIcon, type ActionIconProps } from '@lobehub/ui';
import { ChevronLeftIcon } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';

export const BACK_BUTTON_ID = 'lobe-back-button';

const BackButton = memo<ActionIconProps & { to?: string }>(({ to = '/', onClick, ...rest }) => {
  const navigate = useNavigate();

  return (
    <ActionIcon
      icon={ChevronLeftIcon}
      id={BACK_BUTTON_ID}
      onClick={(e) => {
        navigate(to);
        onClick?.(e);
      }}
      size={DESKTOP_HEADER_ICON_SIZE}
      {...rest}
    />
  );
});

export default BackButton;
