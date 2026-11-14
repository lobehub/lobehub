/**
 * @-mentioned tools are turn-scoped. A resume of the same turn (tool approval,
 * `askUserQuestion`) has to keep them, and the next user turn must not.
 *
 * Skills are different: `collectSelectedSkillIds` keeps every earlier turn.
 * Tool mentions stop at the current turn, which starts at the last user
 * message that is not a steer.
 */

export interface CurrentTurnMessage {
  metadata?: {
    botSender?: unknown;
    externalOrigin?: unknown;
    selectedToolIds?: unknown;
    steer?: unknown;
  } | null;
  role?: string;
}

const isUser = (message: CurrentTurnMessage) => message.role === 'user';

/** A steered row continues the running turn instead of opening a new one. */
const isSteer = (message: CurrentTurnMessage) => message.metadata?.steer === true;

/**
 * Bot-channel rows and external events are not a person's @-mention, even
 * when they carry the field.
 */
const contributesMention = (message: CurrentTurnMessage) =>
  isUser(message) && !message.metadata?.botSender && !message.metadata?.externalOrigin;

const stringIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string' && id.length > 0);
};

/**
 * Tool ids @-mentioned on the turn these messages end on.
 *
 * The turn starts at the last user message that is not a steer. That message
 * and later steer rows contribute; anything older belongs to a previous turn.
 * Deduplicated, in first-seen order.
 */
export const collectCurrentTurnSelectedToolIds = (
  messages: readonly CurrentTurnMessage[],
): string[] => {
  let turnStart = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isUser(message) || isSteer(message)) continue;
    turnStart = index;
    break;
  }
  if (turnStart < 0) return [];

  const ids: string[] = [];
  for (let index = turnStart; index < messages.length; index += 1) {
    const message = messages[index];
    if (!contributesMention(message)) continue;
    ids.push(...stringIds(message.metadata?.selectedToolIds));
  }
  return [...new Set(ids)];
};

export interface ResolveTurnSelectedToolIdsParams {
  /**
   * A prompted turn that was never persisted (`ephemeralUserMessage`). It
   * opens its own turn, so the previous user row's mentions do not apply.
   */
  ephemeralTurn?: boolean;
  loadHistoryMessages: () => Promise<readonly CurrentTurnMessage[]>;
  /** Ids the current request named. Empty on a resume that did not repeat them. */
  selectedToolIds?: readonly string[];
  /**
   * Metadata of the user row this call just created. Absent when the run
   * continues from history (the row is already in `loadHistoryMessages`).
   */
  userMessageMetadata?: CurrentTurnMessage['metadata'];
}

/**
 * The mention set tool discovery enables for this call.
 *
 * A new user row carries its own ids, so prior history is left unread. A steer
 * continues the running turn, and a resume has no new row: both read the
 * current turn back from history and union it with whatever this request sent.
 */
export const resolveTurnSelectedToolIds = async ({
  loadHistoryMessages,
  selectedToolIds,
  userMessageMetadata,
  ephemeralTurn,
}: ResolveTurnSelectedToolIdsParams): Promise<string[]> => {
  const metadata = userMessageMetadata ?? undefined;
  // A new row, or an ephemeral prompt, carries this call's mention, so older
  // turns stay unread. A steer continues the running turn, and a resume has
  // no new row.
  const opensNewTurn = metadata !== undefined || !!ephemeralTurn;
  const history = !opensNewTurn || metadata?.steer === true ? await loadHistoryMessages() : [];
  const messages = opensNewTurn
    ? [...history, { metadata: metadata ?? {}, role: 'user' as const }]
    : history;

  return [
    ...new Set([...stringIds(selectedToolIds), ...collectCurrentTurnSelectedToolIds(messages)]),
  ];
};

/**
 * Ids for the explicit-activation re-check in operation prep: tools a previous
 * step activated, plus this turn's mentions that discovery already accepted.
 *
 * Mentions absent from `acceptedPluginIds` (an exclusive toolset, or the share
 * allowlist) stay out. Historical activations are not filtered that way — they
 * were already admitted on an earlier step.
 */
export const idsForExplicitActivationRecheck = (
  messages: readonly CurrentTurnMessage[],
  historicalActivatedToolIds: readonly string[] = [],
  acceptedPluginIds?: readonly string[],
): string[] => {
  const accepted = acceptedPluginIds ? new Set(acceptedPluginIds) : undefined;
  const mentioned = collectCurrentTurnSelectedToolIds(messages).filter(
    (id) => !accepted || accepted.has(id),
  );
  return [...new Set([...historicalActivatedToolIds, ...mentioned])];
};
