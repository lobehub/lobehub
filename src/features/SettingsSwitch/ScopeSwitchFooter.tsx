'use client';

import { Center, cssVar, Icon } from '@lobehub/ui';
import { HouseIcon } from 'lucide-react';
import { memo } from 'react';

import WorkspaceAvatar from '@/components/WorkspaceAvatar';
import UserAvatar from '@/features/User/UserAvatar';

import { type SettingsScope } from './settingsScope';
import SettingsSwitchCard from './SwitchCard';
import { type SettingsSpace, useSettingsScopeTitle } from './useSettingsScopeTitle';

const AVATAR_SIZE = 24;

interface ScopeSwitchFooterProps {
  space: SettingsSpace;
  switchScope: SettingsScope;
  switchUrl?: string;
}

/** Bottom card of a settings sidebar, leading to the other settings set. */
const ScopeSwitchFooter = memo<ScopeSwitchFooterProps>(({ space, switchScope, switchUrl }) => {
  const title = useSettingsScopeTitle(switchScope, space);

  if (!switchUrl) return null;

  let avatar;
  if (switchScope === 'account') avatar = <UserAvatar size={AVATAR_SIZE} />;
  else if (space.kind === 'workspace')
    avatar = <WorkspaceAvatar avatar={space.avatar} name={space.name} size={AVATAR_SIZE} />;
  else
    avatar = (
      <Center
        height={AVATAR_SIZE}
        style={{ background: cssVar.colorFillTertiary, borderRadius: 6 }}
        width={AVATAR_SIZE}
      >
        <Icon icon={HouseIcon} size={14} />
      </Center>
    );

  return <SettingsSwitchCard avatar={avatar} href={switchUrl} title={title} />;
});

ScopeSwitchFooter.displayName = 'ScopeSwitchFooter';

export default ScopeSwitchFooter;
