import { builtinSkills } from '@lobechat/builtin-skills';
import { LocalSystemApiName, LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import {
  type DeviceFileAccess,
  type ProjectSkillRuntimeItem,
  SkillsExecutionRuntime,
} from '@lobechat/builtin-tool-skills/executionRuntime';
import { resolveShareAllowedSkillIds } from '@lobechat/const';
import type { BuiltinSkill } from '@lobechat/types';
import debug from 'debug';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { TaskModel } from '@/database/models/task';
import type { LobeChatDatabase } from '@/database/type';
import { filterBuiltinSkills } from '@/helpers/skillFilters';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { executeAuthorizedDeviceToolCall } from '@/server/services/deviceGateway/authorizedToolCall';
import {
  canonicalUserSkillIdentifier,
  readTaskSkillIds,
  type UserRuntimeSkill,
  UserSkillService,
} from '@/server/services/userSkill';

import type { ToolExecutionContext } from '../types';
import { type readSkillUserSettings, resolveAgentSkillGates } from './librarySkillGate';
import { resolveContentWorkspaceId, resolveRunWorkspaceId } from './resolveWorkspaceScope';

const log = debug('lobe-server:skill-activation');

export type SkillActivationContext = ToolExecutionContext & {
  serverDB: LobeChatDatabase;
  userId: string;
};

export interface ResolvedSkillActivationResources {
  builtinSkills: BuiltinSkill[];
  deviceFileAccess?: DeviceFileAccess;
  disabledSkillIds: Set<string>;
  isLibrarySkillEnabled?: (identifier: string) => boolean;
  isLibrarySkillReachable: (identifier: string) => boolean;
  isSkillGranted?: (identifier: string) => boolean;
  isSkillReachable: (identifier: string) => boolean;
  listAvailableSkills: () => Promise<Array<{ description?: string; name: string }>>;
  loadUserSkill: (requested: string) => Promise<UserRuntimeSkill | undefined>;
  projectSkills?: ProjectSkillRuntimeItem[];
  resolveDeviceWorkspaceId: () => Promise<string | undefined>;
  resolveSkill: (requested: string) => Promise<BuiltinSkill | undefined>;
  workspaceId?: string;
}

/**
 * Shared skill-source resolution for both `lobe-skills` (`skills.ts`) and the
 * `lobe-activator` skill fallback (`activator.ts`).
 *
 * Keeping one assembly path ensures agent-document bundles (`agent-skills:*`),
 * project/device filesystem skills, user-library skills (`user-skills:*`),
 * workspace recovery, agent tri-state gates, and Agent Share grants behave
 * identically regardless of which tool activated the skill.
 */
export const resolveSkillActivationResources = async (
  context: SkillActivationContext,
  options?: {
    userSettings?: Awaited<ReturnType<typeof readSkillUserSettings>>;
  },
): Promise<ResolvedSkillActivationResources> => {
  // This runtime resolves skills fresh by name/id, so the agent's own
  // tri-state is enforced here too (see `resolveAgentSkillGates`).
  const { disabledSkillIds, isLibrarySkillEnabled } = await resolveAgentSkillGates(
    context,
    options?.userSettings,
  );

  // The share's own opt-out, for the same reason: the creator named the
  // skills a visitor may load (`shareConfig.skillGrants`), and the
  // operation's skill pool was already intersected with that grant at
  // assembly (`filterSkillsByShareGate`) — but `activateSkill` /
  // `readReference` / `execScript` all resolve a MODEL-SUPPLIED name, so a
  // name the pool never offered still arrives here. This predicate is that
  // second, authoritative check.
  //
  // `resolveShareAllowedSkillIds` intersects candidates with the grant, so
  // passing the single id under test makes each call exactly the membership
  // question this predicate asks.
  const shareVisitor = context.agentShareVisitor;
  const isSkillGranted = shareVisitor
    ? (identifier: string) => resolveShareAllowedSkillIds([identifier], shareVisitor).length > 0
    : undefined;

  /**
   * The two opt-outs applied to non-library sources (agent documents, user
   * skill library, filesystem skills) — filtering at assembly closes the
   * fall-through where a refused DB lookup would otherwise match a later branch.
   */
  const isSkillReachable = (identifier: string) =>
    !disabledSkillIds.has(identifier) && (isSkillGranted?.(identifier) ?? true);

  /** Library (DB & builtin) skills additionally require opt-in per agent. */
  const isLibrarySkillReachable = (identifier: string) =>
    isSkillReachable(identifier) && (isLibrarySkillEnabled?.(identifier) ?? true);

  /**
   * The workspace everything this runtime touches belongs to — the skills it
   * can see, the files it writes, and the sandbox session it reaches.
   *
   * Recovered rather than read off the context: the dispatch and resume paths
   * do not carry it, and there a workspace topic resolved in the personal
   * scope, came back "no such topic", and ran ephemeral — `pwd` answered
   * `/workspace` while the conversation showed a persistent instance.
   */
  const workspaceId = await resolveContentWorkspaceId(context);

  let runWorkspaceIdPromise: Promise<string | undefined> | undefined;
  const resolveDeviceWorkspaceId = () => (runWorkspaceIdPromise ??= resolveRunWorkspaceId(context));

  // The user's own skill library is read per call, for the one name asked
  // for — it grows with every goal batch, and this factory runs per tool
  // call. Read under the recovered workspace (a dispatched or resumed run may
  // not carry it on the context).
  const loadUserSkill = async (requested: string): Promise<UserRuntimeSkill | undefined> => {
    // Models vary the casing of a name, as the preloaded lookup tolerates.
    const name = canonicalUserSkillIdentifier(requested);
    if (!name || !isSkillReachable(name)) return undefined;

    try {
      const trustedGenerated = context.taskId
        ? readTaskSkillIds(
            (
              await new TaskModel(context.serverDB, context.userId, workspaceId).findById(
                context.taskId,
              )
            )?.config,
          )
        : [];
      const [skill] = await new UserSkillService(
        context.serverDB,
        context.userId,
        workspaceId,
        context.agentVisibility,
      ).loadRuntimeSkills([name], {
        // Only the generated skills this run's own Task names are trusted
        // past a public agent's visibility — never a name the model chose.
        trustedGenerated,
      });
      return skill;
    } catch (error) {
      log('failed to load user skill %s: %O', name, error);
      return undefined;
    }
  };

  // Surface this agent's skill-bundle documents as `BuiltinSkill`-shaped
  // entries so `activateSkill('agent-skills:<filename>')` resolves on the
  // existing no-DB-lookup path — no `SkillRuntimeService` extension needed.
  // `AgentDocumentsService.getAgentSkills` is the single source of truth for
  // the identifier prefix and the bundle → index-child content resolution
  // (also used by `operationSkillSet.ts` when building `<available_skills>`).
  // `source: 'builtin'` is the type-system carrier shape required by
  // `BuiltinSkill`; the runtime re-tags `source: 'agent'` in the activateSkill
  // result based on the identifier prefix so the inspector can show
  // "Activate Agent Skill" + the friendly `title`.
  const agentSkillBuiltins: BuiltinSkill[] = context.agentId
    ? await new AgentDocumentsService(context.serverDB, context.userId, workspaceId)
        .getAgentSkills(context.agentId)
        .then((skills) =>
          skills
            .filter((skill) => isSkillReachable(skill.identifier))
            .map((skill) => ({
              content: skill.content,
              description: skill.description,
              identifier: skill.identifier,
              name: skill.name,
              source: 'builtin' as const,
              ...(skill.title && { title: skill.title }),
            })),
        )
        .catch((error) => {
          log('failed to load agent skills for agent %s: %O', context.agentId, error);
          return [];
        })
    : [];

  // Project/device skills live on the execution device filesystem. Read them
  // through the device gateway by reusing the local-system tools — no special
  // file-read primitive, just the existing capabilities over deviceGateway.
  //   - `readFile`  loads SKILL.md and validated reference files.
  //   - `globFiles` enumerates the skill directory so `readReference` can
  //     reject paths the model guessed (e.g. `.env`) instead of trusting
  //     the raw string.
  const { activeDeviceId, projectSkills } = context;
  let deviceFileAccess: DeviceFileAccess | undefined;
  if (activeDeviceId) {
    const userId = context.userId;
    deviceFileAccess = {
      listFiles: async (dir: string) => {
        const result = await executeAuthorizedDeviceToolCall(
          context.serverDB,
          {
            deviceId: activeDeviceId,
            userId,
            workspaceId: await resolveDeviceWorkspaceId(),
          },
          {
            apiName: LocalSystemApiName.globFiles,
            // `**/*` matches every regular file recursively under `dir`.
            // The device-side enumerator already skips hidden files; the
            // runtime re-checks segments as defense in depth.
            arguments: JSON.stringify({ pattern: '**/*', scope: dir }),
            identifier: LocalSystemIdentifier,
          },
        );
        if (!result.success) {
          throw new Error(result.error || result.content || `globFiles failed: ${dir}`);
        }
        let payload: { files?: unknown };
        try {
          payload = JSON.parse(result.content) as { files?: unknown };
        } catch {
          throw new Error(`globFiles returned a non-JSON payload for ${dir}`);
        }
        if (!Array.isArray(payload.files)) return [];
        // Files come back as paths relative to `scope` (POSIX). Strip any
        // absolute path the engine may have emitted so the runtime can
        // compare against normalized user-supplied relative paths.
        return payload.files
          .filter((f): f is string => typeof f === 'string')
          .map((f) => (f.startsWith(dir) ? f.slice(dir.length).replace(/^[/\\]+/, '') : f));
      },
      readFile: async (filePath: string) => {
        const result = await executeAuthorizedDeviceToolCall(
          context.serverDB,
          {
            deviceId: activeDeviceId,
            userId,
            workspaceId: await resolveDeviceWorkspaceId(),
          },
          {
            apiName: LocalSystemApiName.readFile,
            // Read the whole file; SKILL.md and references are small.
            arguments: JSON.stringify({ loc: [0, 5000], path: filePath }),
            identifier: LocalSystemIdentifier,
          },
        );
        if (!result.success) {
          throw new Error(result.error || result.content || `readFile failed: ${filePath}`);
        }
        return result.content;
      },
    };
  }

  const resolveSkill = async (requested: string): Promise<BuiltinSkill | undefined> => {
    const skill = await loadUserSkill(requested);
    return (
      skill && {
        content: skill.body,
        description: skill.description,
        identifier: skill.identifier,
        name: skill.name,
        resources: skill.resources,
        source: 'builtin' as const,
        title: skill.title,
      }
    );
  };

  // Called only on an `activateSkill` miss so the not-found recovery list
  // includes the user's skill library without paying a catalog query on hits.
  const listAvailableSkills = async (): Promise<Array<{ description?: string; name: string }>> => {
    try {
      const userSkillService = new UserSkillService(
        context.serverDB,
        context.userId,
        workspaceId,
        context.agentVisibility,
      );
      const catalog = await userSkillService.listCatalog({ includeGenerated: false });
      return catalog
        .filter((skill) => isSkillReachable(skill.identifier))
        .map((skill) => ({ description: skill.description, name: skill.name }));
    } catch (error) {
      log('failed to list user skills catalog: %O', error);
      return [];
    }
  };

  return {
    builtinSkills: [
      // Match the device and opt-in gates of the operation's skill catalog.
      ...filterBuiltinSkills(builtinSkills, {
        canExecuteOnDevice: context.deviceCapable ?? !!activeDeviceId,
      }).filter((skill) => isLibrarySkillReachable(skill.identifier)),
      ...agentSkillBuiltins,
    ],
    deviceFileAccess,
    disabledSkillIds,
    isLibrarySkillEnabled,
    isLibrarySkillReachable,
    isSkillGranted,
    isSkillReachable,
    listAvailableSkills,
    loadUserSkill,
    // Filesystem skills carry no identifier of their own; the skill pool
    // derives one as `<source>:<name>` (see `operationSkillSet`'s `projectMetas`)
    // and that is what a `skillGrants` entry names, so rebuild it the same
    // way rather than matching on the bare name.
    projectSkills: projectSkills?.filter((skill) =>
      isSkillReachable(`${skill.source ?? 'project'}:${skill.name}`),
    ),
    resolveDeviceWorkspaceId,
    resolveSkill,
    workspaceId,
  };
};

/**
 * Create a read-only `SkillsExecutionRuntime` for `lobe-activator`'s
 * `activateSkill` / `activateTools` skill fallback, wired to the exact same
 * sources and gates as `lobe-skills`.
 */
export const createSkillActivationRuntime = async (
  context: SkillActivationContext,
): Promise<SkillsExecutionRuntime> => {
  const resources = await resolveSkillActivationResources(context);
  const skillModel = new AgentSkillModel(context.serverDB, context.userId, resources.workspaceId);

  return new SkillsExecutionRuntime({
    builtinSkills: resources.builtinSkills,
    deviceFileAccess: resources.deviceFileAccess,
    listAvailableSkills: resources.listAvailableSkills,
    projectSkills: resources.projectSkills,
    resolveSkill: resources.resolveSkill,
    service: {
      findAll: async () => {
        const result = await skillModel.findAll();
        if (
          !resources.isSkillGranted &&
          !resources.isLibrarySkillEnabled &&
          resources.disabledSkillIds.size === 0
        ) {
          return result;
        }

        const data = result.data.filter((skill) =>
          resources.isLibrarySkillReachable(skill.identifier),
        );
        return { data, total: data.length };
      },
      findById: async (id) => {
        const skill = await skillModel.findById(id);
        return skill && resources.isLibrarySkillReachable(skill.identifier) ? skill : undefined;
      },
      findByName: async (name) => {
        const skill = await skillModel.findByName(name);
        return skill && resources.isLibrarySkillReachable(skill.identifier) ? skill : undefined;
      },
      readResource: async () => {
        throw new Error('readResource not available in tools runtime');
      },
    },
  });
};
