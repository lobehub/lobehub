'use client';

import { isDesktop } from '@lobechat/const';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import { SettingsFormSkeleton, SWITCH_CONTROL } from '../Section';
import { useSkeletonText } from '../useSkeletonText';
import type { SettingsTabSkeleton } from './types';

/** Tools group: gateway mode when enabled; on desktop the diagnostics package, debug logs and remote debugging. */
const Body = () => {
  const text = useSkeletonText('setting');
  const enableGatewayMode = useServerConfigStore(serverConfigSelectors.enableGatewayMode);

  const toolItems = [
    ...(enableGatewayMode
      ? [
          {
            control: SWITCH_CONTROL,
            desc: text('tab.advanced.gatewayMode.desc', 280, 12),
            label: text('tab.advanced.gatewayMode.title', 112),
            minWidth: undefined,
          },
        ]
      : []),
    ...(isDesktop
      ? [
          {
            control: { height: 32, width: 300 },
            desc: text('settingAbout.diagnostics.bundle.desc', 280, 12),
            label: text('settingAbout.diagnostics.bundle.title', 96),
            minWidth: undefined,
          },
          {
            control: { height: 32, width: 160 },
            desc: text('settingAbout.debugLogs.desc', 280, 12),
            label: text('settingAbout.debugLogs.title', 96),
            minWidth: undefined,
          },
          {
            control: SWITCH_CONTROL,
            desc: text('settingAbout.remoteDebugging.desc', 280, 12),
            label: text('settingAbout.remoteDebugging.title', 96),
            minWidth: undefined,
          },
        ]
      : []),
  ];

  return (
    <SettingsFormSkeleton
      groups={
        toolItems.length > 0
          ? [{ items: toolItems, title: text('tab.advanced.toolsAndDiagnostics.title', 160, 16) }]
          : []
      }
    />
  );
};

const AdvancedSkeleton: SettingsTabSkeleton = { Body };

export default AdvancedSkeleton;
