'use client';

import { isDesktop } from '@lobechat/const';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import { SettingsFormSkeleton, SWITCH_CONTROL } from '../Section';
import { useSkeletonText } from '../useSkeletonText';
import type { SettingsTabSkeleton } from './types';

/** Tools group (dev mode + gateway mode when enabled) and, on desktop, the update channel. */
const Body = () => {
  const text = useSkeletonText('setting');
  const enableGatewayMode = useServerConfigStore(serverConfigSelectors.enableGatewayMode);

  return (
    <SettingsFormSkeleton
      groups={[
        {
          items: [
            {
              control: SWITCH_CONTROL,
              desc: text('settingCommon.devMode.desc', 240, 12),
              label: text('settingCommon.devMode.title', 96),
              minWidth: undefined,
            },
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
          ],
          title: text('tab.advanced.toolsAndDiagnostics.title', 160, 16),
        },
        ...(isDesktop
          ? [
              {
                items: [
                  {
                    desc: text('tab.advanced.updateChannel.desc', 240, 12),
                    label: text('tab.advanced.updateChannel.title', 96),
                  },
                ],
                title: text('tab.advanced.appUpdates.title', 112, 16),
              },
            ]
          : []),
      ]}
    />
  );
};

const AdvancedSkeleton: SettingsTabSkeleton = { Body };

export default AdvancedSkeleton;
