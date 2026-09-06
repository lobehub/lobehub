import { parseSelectedSkillTags } from '@lobechat/context-engine';
import type { StepActivatedSkill, StepContextTodos, UIChatMessage } from '@lobechat/types';
import { isNonEmptyString, isPlainRecord } from '@lobechat/utils/object';

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

const isTodoItem = (value: unknown): value is StepContextTodos['items'][number] =>
  isPlainRecord(value) &&
  typeof value.text === 'string' &&
  (value.status === 'todo' || value.status === 'processing' || value.status === 'completed');

/** Normalize persisted canonical and legacy TODO states without guessing alternate fields. */
export const normalizeTodosState = (
  value: unknown,
  fallbackUpdatedAt: string,
): StepContextTodos | undefined => {
  const items = Array.isArray(value)
    ? value
    : isPlainRecord(value) && Array.isArray(value.items)
      ? value.items
      : undefined;

  if (!items || !items.every(isTodoItem)) return undefined;

  const updatedAt =
    isPlainRecord(value) && isNonEmptyString(value.updatedAt) ? value.updatedAt : fallbackUpdatedAt;

  return { items, updatedAt };
};

/** Select the newest valid exact `pluginState.todos` state across flat and grouped messages. */
export const extractTodosFromMessages = (
  messages: UIChatMessage[],
): StepContextTodos | undefined => {
  const fallbackUpdatedAt = new Date().toISOString();

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const invocations = collectToolInvocations(messages[messageIndex]);
    for (let invocationIndex = invocations.length - 1; invocationIndex >= 0; invocationIndex--) {
      const state = invocations[invocationIndex].state;
      if (!isPlainRecord(state) || !Object.hasOwn(state, 'todos')) continue;

      const todos = normalizeTodosState(state.todos, fallbackUpdatedAt);
      if (todos !== undefined) return todos;
    }
  }

  return undefined;
};

/**
 * Resolve the active skill set for `execScript` cwd resolution.
 *
 * Two activation sources, with different scopes:
 * - `activateSkill` / `activateTools` tool results accumulate across the whole
 *   conversation — a skill once activated stays available for later requests.
 * - `/skill` slash-preloaded skills are scoped to the CURRENT request only
 *   (SelectedSkillInjector marks them "for this request"), so only the latest
 *   user message's `<selected_skills>` tags are parsed — older slash selections
 *   must not leak into a request that didn't select them.
 *
 * The skill id (or name, for filesystem/builtin activations that persist no
 * id) deduplicates — a reactivation updates the entry AND moves it to the end,
 * since exec paths treat the last entry as the most recent activation when
 * picking the script cwd. Slash tags are inserted at the latest user message's
 * natural chronological position (not appended at the end) so an
 * `activateSkill` call later in the SAME turn still wins the cwd — "last
 * activation wins" must hold across both sources.
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

  // The /skill slash preload path is scoped to the CURRENT request: only the
  // latest user message's tags are parsed, so older slash selections can't
  // leak into a request that didn't select them. Resolve its index up front so
  // the main loop can insert those activations at their natural chronological
  // position — preserving "last activation wins the cwd" relative to
  // activateSkill/activateTools tool calls later in the same turn.
  let slashUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      slashUserIndex = i;
      break;
    }
  }

  // Explicit activateSkill / activateTools tool results accumulate across the
  // whole conversation — a skill once activated stays available for the rest
  // of the conversation. (The skill id, or name for id-less filesystem/builtin
  // activations, deduplicates; a reactivation moves it to the end since exec
  // paths treat the last entry as the most recent activation for the cwd.)
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

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

    // /skill slash-preloaded skills: their content is inlined into the user
    // message as a <selected_skill_context> block (see
    // formatSelectedSkillsContext in @lobechat/context-engine) WITHOUT a
    // synthetic activateSkill tool call, so the tool-invocation scan above
    // can't see them. Parse ONLY the latest user message (slashUserIndex) —
    // older slash selections must not leak into the current request. Inserted
    // here, at the message's natural position, so a later activateSkill in the
    // same turn still wins the cwd. The identifier doubles as `name` (DB skills
    // commonly have name === identifier); consumers resolve by identifier
    // first, falling back to name when identifier differs.
    if (i === slashUserIndex && typeof msg.content === 'string') {
      for (const tag of parseSelectedSkillTags(msg.content)) {
        const key = tag.identifier;
        skillsMap.delete(key);
        skillsMap.set(key, { identifier: tag.identifier, name: tag.identifier });
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
