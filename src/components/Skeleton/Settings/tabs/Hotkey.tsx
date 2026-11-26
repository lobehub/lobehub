'use client';

import { isDesktop } from '@lobechat/const';
import { HotkeyGroupEnum } from '@lobechat/const/hotkeys';

import { DESKTOP_HOTKEYS_REGISTRATION } from '@/const/desktopGlobalShortcuts';
import { HOTKEYS_REGISTRATION } from '@/const/hotkeys';

import SkeletonBar from '../../Bar';
import { SettingsFormSkeleton } from '../Section';
import { useSkeletonText } from '../useSkeletonText';
import type { SettingsTabSkeleton } from './types';

/** Hotkey recorder inputs settle at 335x36. */
const RECORDER = { height: 36, radius: 8, width: 335 };

/** One hotkey group: real group title and shortcut names, recorder placeholders. */
const HotkeyGroupSkeleton = ({
  desc,
  labelKeys,
  rows,
  titleKey,
}: {
  desc?: string;
  labelKeys?: string[];
  rows?: number;
  titleKey: string;
}) => {
  const setting = useSkeletonText('setting');
  const hotkey = useSkeletonText('hotkey');
  const labels = labelKeys
    ? labelKeys.map((key) => hotkey(key, 96, 14))
    : Array.from({ length: rows ?? 0 }, (_, index) => (
        <SkeletonBar height={14} key={index} width={96 + (index % 3) * 24} />
      ));

  return (
    <SettingsFormSkeleton
      groups={[
        {
          desc: desc && setting(desc, 220, 12),
          items: labels.map((label) => ({ control: RECORDER, label })),
          title: setting(titleKey, 96),
        },
      ]}
    />
  );
};

const groupKeys = (group: (typeof HotkeyGroupEnum)[keyof typeof HotkeyGroupEnum]) =>
  HOTKEYS_REGISTRATION.filter((item) => item.group === group).map((item) => `${item.id}.title`);

export const EssentialHotkeysSkeleton = () => (
  <HotkeyGroupSkeleton
    labelKeys={groupKeys(HotkeyGroupEnum.Essential)}
    titleKey={'hotkey.group.essential'}
  />
);

export const ConversationHotkeysSkeleton = () => (
  <HotkeyGroupSkeleton
    labelKeys={groupKeys(HotkeyGroupEnum.Conversation)}
    titleKey={'hotkey.group.conversation'}
  />
);

export const DesktopHotkeysSkeleton = () => (
  <HotkeyGroupSkeleton
    labelKeys={DESKTOP_HOTKEYS_REGISTRATION.map((item) => `desktop.${item.id}.title`)}
    titleKey={'hotkey.group.desktop'}
  />
);

/** The app-menu shortcuts come from the live Electron menu, so their names are unknown here. */
export const AppMenuHotkeysSkeleton = () => (
  <HotkeyGroupSkeleton
    desc={'hotkey.group.appMenuDesc'}
    rows={8}
    titleKey={'hotkey.group.appMenu'}
  />
);

/** Desktop shortcuts (Electron), essential, conversation and app-menu (Electron) groups. */
const Body = () => (
  <>
    {isDesktop && <DesktopHotkeysSkeleton />}
    <EssentialHotkeysSkeleton />
    <ConversationHotkeysSkeleton />
    {isDesktop && <AppMenuHotkeysSkeleton />}
  </>
);

const HotkeySkeleton: SettingsTabSkeleton = { Body };

export default HotkeySkeleton;
