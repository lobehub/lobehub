'use client';

import SettingsSectionSkeleton from '../Section';
import { useSkeletonText } from '../useSkeletonText';
import type { SettingsTabSkeleton } from './types';

/**
 * The proxy form: enable, basic settings (type / server / port), auth and
 * connection-test groups of one grouped form, 16px apart. Credentials stay
 * hidden until the proxy and auth are enabled, so the auth group has one row.
 */
const Body = () => {
  const text = useSkeletonText('electron');

  return (
    <SettingsSectionSkeleton
      gap={16}
      groups={[
        {
          control: { height: 22, width: 44 },
          labels: [text('proxy.enable', 64)],
          rows: 1,
          title: text('proxy.enable', 64, 18),
        },
        {
          controls: {
            0: { height: 22, width: 220 },
            1: { height: 32, width: 336 },
            2: { height: 32, width: 120 },
          },
          labels: [text('proxy.type', 40), text('proxy.server', 56), text('proxy.port', 40)],
          rows: 3,
          title: text('proxy.basicSettings', 80, 18),
          withDesc: [false, true, true],
        },
        {
          control: { height: 22, width: 44 },
          labels: [text('proxy.auth', 72)],
          rows: 1,
          title: text('proxy.authSettings', 80, 18),
        },
        {
          control: { height: 32, width: 264 },
          labels: [text('proxy.testUrl', 72)],
          rows: 1,
          title: text('proxy.connectionTest', 80, 18),
        },
      ]}
    />
  );
};

const ProxySkeleton: SettingsTabSkeleton = { Body };

export default ProxySkeleton;
