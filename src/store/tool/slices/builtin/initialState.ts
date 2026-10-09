import { builtinSkillManifests } from '@lobechat/builtin-skills/manifests';
import { builtinTools, defaultUninstalledBuiltinTools } from '@lobechat/builtin-tools';
import { type BuiltinSkillManifest, type LobeBuiltinTool } from '@lobechat/types';

import { filterBuiltinSkills } from '@/helpers/skillFilters';
import { createReplicaState, type ReplicaState } from '@/libs/replica';

export interface BuiltinToolState {
  builtinSkills: BuiltinSkillManifest[];
  builtinToolLoading: Record<string, boolean>;
  builtinTools: LobeBuiltinTool[];
  /**
   * Whether the uninstalled-tools view has been filled (from storage or the
   * server). Gates the replica lens: before the first hydrate / replace the
   * view must read `undefined`, otherwise the default seed would block
   * hydration from storage.
   */
  isUninstalledBuiltinToolsInit: boolean;
  /**
   * List of uninstalled builtin tool identifiers — the view of the
   * `uninstalledBuiltinTools` replica.
   *
   * Empty array means all builtin tools are enabled; the default seed lists
   * the ones the user still has to install explicitly.
   */
  uninstalledBuiltinTools: string[];
  /** Replica bookkeeping for `uninstalledBuiltinTools`. */
  uninstalledBuiltinToolsReplica: ReplicaState<string[]>;
}

export const initialBuiltinToolState: BuiltinToolState = {
  builtinSkills: filterBuiltinSkills(builtinSkillManifests),
  builtinToolLoading: {},
  builtinTools,
  isUninstalledBuiltinToolsInit: false,
  uninstalledBuiltinTools: defaultUninstalledBuiltinTools,
  uninstalledBuiltinToolsReplica: createReplicaState(),
};
