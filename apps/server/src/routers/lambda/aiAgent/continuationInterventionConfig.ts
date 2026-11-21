import type { UserInterventionConfig, UserToolConfig } from '@lobechat/types';

type PersistedIntervention = NonNullable<UserToolConfig['humanIntervention']>;

/**
 * The owner's intervention config for a continuation, given the parked run's
 * snapshot (`inherited`) and the owner's persisted preference (`persisted`).
 *
 * The continuation inherits the parked run's policy, with two answers the user
 * may have given on the approval card itself, both persisted before dispatch:
 * - "Approve, and don't ask again" appended a tool key to the allow list;
 * - "Switch to auto approve" moved the preference to `auto-run`, which lifts a
 *   manual / allow-list run (never a headless one, which cannot park anyway).
 *
 * Without a snapshot (expired state) the owner's foreground preference applies:
 * only a run that could wait for a human parks, so it was never headless.
 */
export const mergeContinuationUserInterventionConfig = ({
  inherited,
  persisted,
}: {
  inherited?: UserInterventionConfig;
  persisted?: PersistedIntervention;
}): UserInterventionConfig => {
  const persistedAllowList = persisted?.allowList ?? [];
  const persistedAutoRun =
    persisted?.approvalMode === 'auto-run' || persisted?.approvalMode === 'headless';

  if (!inherited) {
    return {
      allowList: persistedAllowList,
      approvalMode: persistedAutoRun ? 'auto-run' : (persisted?.approvalMode ?? 'manual'),
    };
  }

  let config = inherited;

  const inheritedAllowList = inherited.allowList ?? [];
  const remembered = persistedAllowList.filter((key) => !inheritedAllowList.includes(key));
  if (remembered.length > 0) {
    config = { ...config, allowList: [...inheritedAllowList, ...remembered] };
  }

  const interactive =
    !inherited.approvalMode ||
    inherited.approvalMode === 'manual' ||
    inherited.approvalMode === 'allow-list';
  if (persistedAutoRun && interactive) config = { ...config, approvalMode: 'auto-run' };

  return config;
};
