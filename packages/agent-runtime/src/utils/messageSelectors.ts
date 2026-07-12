import type { StepActivatedSkill, UIChatMessage } from '@lobechat/types';

/**
 * Wire-format tool identifiers that carry skill activations in their
 * pluginState. Literal copies of `SkillsIdentifier`
 * (@lobechat/builtin-tool-skills) and `LobeActivatorIdentifier`
 * (@lobechat/builtin-tool-activator) — both are frozen, persisted in DB
 * message rows, and not importable here without adding tool-package deps to
 * the runtime core.
 */
const SKILLS_IDENTIFIER = 'lobe-skills';
const ACTIVATOR_IDENTIFIER = 'lobe-activator';

/**
 * Options for message visitor traversal
 */
export interface MessageVisitorOptions {
  /**
   * Filter by message role (e.g. 'tool', 'user', 'assistant')
   */
  role?: UIChatMessage['role'];
}

/**
 * Find the first matching result by visiting messages in reverse order (newest first).
 *
 * A generic message traversal utility following the AST visitor pattern.
 * The visitor function is called for each message that passes the filter.
 * Returns immediately when the visitor returns a non-undefined value.
 *
 * @example
 * ```typescript
 * // Extract device context from most recent tool message
 * const device = findInMessages(messages, (msg) => {
 *   const id = msg.pluginState?.metadata?.activeDeviceId;
 *   if (id) return { activeDeviceId: id };
 * }, { role: 'tool' });
 *
 * // Find latest lobe-agent todos
 * const todos = findInMessages(messages, (msg) => {
 *   if (msg.plugin?.identifier === LobeAgentIdentifier) return msg.pluginState?.todos;
 * }, { role: 'tool' });
 * ```
 */
export const findInMessages = <T>(
  messages: UIChatMessage[],
  visitor: (msg: UIChatMessage) => T | undefined,
  options?: MessageVisitorOptions,
): T | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (options?.role && msg.role !== options.role) continue;

    const result = visitor(msg);
    if (result !== undefined) return result;
  }

  return undefined;
};

/**
 * Collect all matching results by visiting messages in forward order.
 *
 * Unlike `findInMessages` which returns the first match, this function
 * collects all non-undefined visitor results. Useful for cumulative
 * state like activated tool IDs.
 *
 * @example
 * ```typescript
 * // Accumulate activated tool identifiers
 * const tools = collectFromMessages(messages, (msg) => {
 *   if (msg.plugin?.identifier === LobeActivatorIdentifier) {
 *     return msg.pluginState?.activatedTools;
 *   }
 * }, { role: 'tool' });
 * ```
 */
export const collectFromMessages = <T>(
  messages: UIChatMessage[],
  visitor: (msg: UIChatMessage) => T | undefined,
  options?: MessageVisitorOptions,
): T[] => {
  const results: T[] = [];

  for (const msg of messages) {
    if (options?.role && msg.role !== options.role) continue;

    const result = visitor(msg);
    if (result !== undefined) results.push(result);
  }

  return results;
};

/**
 * A single tool invocation observed in the conversation, normalized across the
 * two message shapes activations can arrive in (see
 * `collectToolInvocations`).
 */
interface ToolInvocation {
  apiName?: string;
  identifier?: string;
  state?: any;
}

/**
 * Normalize one message into the tool invocations it carries.
 *
 * Two shapes must be handled:
 * 1. Flat DB rows — `role='tool'` messages with `plugin` / `pluginState`
 *    (client store, `execAgent` initialMessages, same-run pushed results).
 * 2. Virtual grouped nodes produced by conversation-flow `parse()` — the
 *    server runtime rehydrates `state.messages` from the DB at every step
 *    (`rehydrateStateMessagesFromDB`), which folds completed turns into
 *    `assistantGroup` / `supervisor` nodes: tool rows disappear as standalone
 *    entries and live on `children[].tools[]` instead, with the original
 *    `pluginState` re-attached as `result.state` (see
 *    FlatListBuilder.createAssistantGroupMessage). Without this branch,
 *    cross-turn skill activations are invisible to later runs.
 *    `compressedGroup` nodes keep their members on `compressedMessages` in
 *    the same flat-list shape, so recurse into them.
 */
const collectToolInvocations = (msg: UIChatMessage): ToolInvocation[] => {
  if (msg.role === 'tool') {
    return [
      { apiName: msg.plugin?.apiName, identifier: msg.plugin?.identifier, state: msg.pluginState },
    ];
  }

  const invocations: ToolInvocation[] = [];

  const { children } = msg;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (!Array.isArray(child?.tools)) continue;
      for (const tool of child.tools) {
        invocations.push({
          apiName: tool?.apiName,
          identifier: tool?.identifier,
          state: tool?.result?.state,
        });
      }
    }
  }

  const { compressedMessages } = msg;
  if (Array.isArray(compressedMessages)) {
    for (const compressed of compressedMessages) {
      invocations.push(...collectToolInvocations(compressed));
    }
  }

  return invocations;
};

/**
 * Accumulate activated skills from all activateSkill / activateTools tool
 * messages. Skills once activated remain active for the rest of the
 * conversation; the skill id (or name, for filesystem/builtin activations that
 * persist no id) deduplicates — a reactivation updates the entry AND moves it
 * to the end, since exec paths treat the last entry as the most recent
 * activation when picking the script cwd.
 *
 * Shared by the client transport (chat store dbMessage selector feeding
 * `computeStepContext`) and the server runtime executors (`callTool` /
 * `callToolsBatch`), so both execution paths resolve the same activation set
 * for skills `execScript`. Handles both flat `role='tool'` rows and the
 * conversation-flow grouped shape (`assistantGroup` etc.) — see
 * `collectToolInvocations`.
 */
export const extractActivatedSkillsFromMessages = (
  messages: UIChatMessage[],
): StepActivatedSkill[] | undefined => {
  const skillsMap = new Map<string, StepActivatedSkill>();

  for (const msg of messages) {
    for (const invocation of collectToolInvocations(msg)) {
      if (!(
        invocation.identifier === SKILLS_IDENTIFIER ||
        invocation.identifier === ACTIVATOR_IDENTIFIER
      ))
        continue;

      // Direct activateSkill calls — state has top-level name (id only for DB
      // skills; filesystem/builtin activations persist no id, so `name` alone
      // must be enough to keep them — server exec paths match by name anyway).
      if (invocation.apiName === 'activateSkill' && invocation.state?.name) {
        const id = invocation.state.id as string | undefined;
        const name = invocation.state.name as string;
        const key = id ?? name;
        // Delete before set so reactivation moves the skill to the end —
        // downstream exec paths pick the LAST resolvable skill as cwd, so
        // insertion order must reflect activation recency (A → B → A must
        // yield [B, A], not Map#set's kept-in-place [A, B]).
        skillsMap.delete(key);
        skillsMap.set(key, {
          description: invocation.state.description as string | undefined,
          ...(id && { id }),
          name,
        });
      }

      // activateTools fallback — skills nested in pluginState.activatedSkills[]
      if (
        invocation.apiName === 'activateTools' &&
        Array.isArray(invocation.state?.activatedSkills)
      ) {
        for (const skill of invocation.state.activatedSkills as Array<{
          description?: string;
          id?: string;
          name?: string;
        }>) {
          if (skill.name) {
            const key = skill.id ?? skill.name;
            // Same delete-before-set as above: keep activation recency.
            skillsMap.delete(key);
            skillsMap.set(key, {
              description: skill.description,
              ...(skill.id && { id: skill.id }),
              name: skill.name,
            });
          }
        }
      }
    }
  }

  return skillsMap.size > 0 ? [...skillsMap.values()] : undefined;
};

/**
 * Accumulate tool identifiers activated by lobe-activator across conversation
 * turns. A new operation uses these identifiers to restore its step-level tool
 * state, keeping discovered tools callable after the operation boundary.
 */
export const extractActivatedToolIdsFromMessages = (
  messages: UIChatMessage[],
): string[] | undefined => {
  const toolIds = new Set<string>();

  for (const msg of messages) {
    for (const invocation of collectToolInvocations(msg)) {
      if (
        invocation.identifier !== ACTIVATOR_IDENTIFIER ||
        invocation.apiName !== 'activateTools' ||
        !Array.isArray(invocation.state?.activatedTools)
      )
        continue;

      for (const tool of invocation.state.activatedTools as Array<{ identifier?: string }>) {
        if (tool.identifier) toolIds.add(tool.identifier);
      }
    }
  }

  return toolIds.size > 0 ? [...toolIds] : undefined;
};
