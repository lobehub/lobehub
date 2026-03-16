'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { FlaskConical } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router-dom';

import ThemeButton from '@/features/User/UserPanel/ThemeButton';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors';

const Footer = memo(() => {
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  return (
    <Flexbox horizontal align={'center'} gap={2} justify={'space-between'} padding={8}>
      <Flexbox horizontal align={'center'} flex={1} gap={2}>
        {isDevMode && (
          <Link to="/eval">
            <ActionIcon icon={FlaskConical} size={16} title="Evaluation Lab" />
          </Link>
        )}
      </Flexbox>
      <ThemeButton placement={'topCenter'} size={16} />
    </Flexbox>
  );
});

export default Footer;
