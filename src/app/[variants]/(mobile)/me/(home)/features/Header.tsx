'use client';

import { ActionIcon } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { Moon, Sun } from 'lucide-react';
import { useTheme as useNextThemesTheme } from 'next-themes';
import { memo } from 'react';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useIsDark } from '@/hooks/useIsDark';

const Header = memo(() => {
  const { setTheme } = useNextThemesTheme();
  const isDark = useIsDark();

  return (
    <ChatHeader
      right={
        <ActionIcon
          icon={isDark ? Moon : Sun}
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          size={MOBILE_HEADER_ICON_SIZE}
        />
      }
    />
  );
});

export default Header;
