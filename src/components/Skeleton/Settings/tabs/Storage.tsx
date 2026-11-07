'use client';

import { Flexbox } from '@lobehub/ui';

import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';

import SettingsSectionSkeleton, { type SettingsSectionSkeletonGroup } from '../Section';
import { useSkeletonText } from '../useSkeletonText';
import type { SettingsTabSkeleton } from './types';

/**
 * The storage tab: the actions group (import, export on Cloud, reset), the
 * analytics group when docs are hidden, and on Cloud the account-deletion group
 * 16px below. Group titles and row labels are static copy.
 */
const Body = () => {
  const text = useSkeletonText('setting');
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const { hideDocs } = useServerConfigStore(featureFlagsSelectors);

  const actions: SettingsSectionSkeletonGroup = {
    control: { height: 32, width: 88 },
    labels: [
      text('storage.actions.import.title', 64),
      ...(enableBusinessFeatures ? [text('storage.actions.export.title', 64)] : []),
      text('danger.reset.title', 96),
    ],
    rows: enableBusinessFeatures ? 3 : 2,
    title: text('storage.actions.title', 64, 18),
    withDesc: enableBusinessFeatures ? [false, false, true] : [false, true],
  };
  const analytics: SettingsSectionSkeletonGroup = {
    control: { height: 22, width: 44 },
    labels: [text('analytics.telemetry.title', 96)],
    rows: 1,
    title: text('analytics.title', 64, 18),
  };

  return (
    <Flexbox aria-busy gap={16}>
      <SettingsSectionSkeleton gap={16} groups={[...(hideDocs ? [analytics] : []), actions]} />
      {enableBusinessFeatures && <AccountDeletionSkeleton />}
    </Flexbox>
  );
};

/** Cloud's account-deletion group: one labelled row with a description and a danger button. */
export const AccountDeletionSkeleton = () => {
  const text = useSkeletonText('setting');

  return (
    <SettingsSectionSkeleton
      groups={[
        {
          control: { height: 32, width: 112 },
          labels: [text('accountDeletion.title', 64)],
          rows: 1,
          title: text('accountDeletion.sectionTitle', 64, 18),
        },
      ]}
    />
  );
};

const StorageSkeleton: SettingsTabSkeleton = { Body };

export default StorageSkeleton;
