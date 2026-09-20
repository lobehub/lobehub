import { LOADING_FLAT } from '@lobechat/const';
import type { UIChatMessage } from '@lobechat/types';

import { getToolProjector } from './registry';
import type { ToolProjection, ToolProjector } from './types';

/** Resolves the projector for one tool call. Injectable so the pipeline can be
 *  exercised without mutating the process-wide registry. */
export type ProjectorResolver = (
  identifier?: string | null,
  apiName?: string | null,
) => ToolProjector | undefined;

/**
 * What a tool message without a projector gets.
 *
 * The body is the MODEL's copy of the result. On screen it reaches exactly two
 * surfaces, both of which open on demand and both of which now hydrate: the
 * fallback renderer and the raw/debug viewer. No collapsed row reads it —
 * inspectors take `result.error` and the settled-ness of `result`, never its
 * content — so dropping it costs the list nothing.
 *
 * `pluginState` is deliberately NOT touched here. It is read far outside the
 * expanded card: the collapsed row's own chips, `getBuiltinRenderDisplayControl`
 * deciding whether a card auto-opens, and whole-list selectors
 * (`selectTodosFromMessages`, `selectActivatedToolIdsFromMessages`,
 * `selectActivatedSkillsFromMessages`). Those run before any expansion, so
 * "fetch it back on open" cannot cover them — which is exactly what a per-tool
 * projector is for: it knows which state keys the collapsed row needs.
 */
const BODY_ONLY_PROJECTION: ToolProjection = { content: null, storedPayloadNeededBy: 'render' };

const projectToolMessage = (message: UIChatMessage, resolve: ProjectorResolver): UIChatMessage => {
  const projector = resolve(message.plugin?.identifier, message.plugin?.apiName);

  // No projector: keep the state whole and drop just the body — and only when
  // there is a settled body. An empty result would be flagged for a fetch that
  // returns nothing, and the streaming sentinel is the one string whose
  // presence in `content` is how the row is known to be still running.
  if (!projector) {
    const hasSettledBody = !!message.content && message.content !== LOADING_FLAT;
    return hasSettledBody ? applyProjection(message, BODY_ONLY_PROJECTION) : message;
  }

  let projection;
  try {
    projection = projector({
      apiName: message.plugin!.apiName,
      arguments: message.plugin?.arguments,
      content: message.content,
      identifier: message.plugin!.identifier,
      pluginState: message.pluginState,
    });
  } catch (error) {
    // A projector is a read-path detail; a bad one must degrade to today's
    // behaviour rather than fail the whole conversation load.
    console.error(
      '[toolViewModel] projector threw for %s/%s: %O',
      message.plugin?.identifier,
      message.plugin?.apiName,
      error,
    );
    return message;
  }

  if (!projection) return message;

  return applyProjection(message, projection);
};

const applyProjection = (message: UIChatMessage, projection: ToolProjection): UIChatMessage => {
  const replacedContent = projection.content !== undefined;
  const replacedState = projection.pluginState !== undefined;
  if (!replacedContent && !replacedState) return message;

  return {
    ...message,
    // Presence checks (the tool status icon, the assistant group's "is this
    // tool settled" test) read the body's length, not the body. Preserve it
    // from the ORIGINAL content so a trimmed body never reads as "returned
    // nothing".
    contentLength: message.content?.length ?? 0,
    ...(replacedContent && { content: projection.content ?? '' }),
    // Tells the client the stored payload is larger than what it holds, and
    // which surface has to fetch it back.
    payloadOmitted: projection.storedPayloadNeededBy ?? 'detail',
    ...(replacedState && { pluginState: projection.pluginState }),
  };
};

/**
 * Reduce every tool message in a query result to its render-facing view model.
 *
 * Applies ONLY to the UI read path. The model-facing read goes straight through
 * `MessageModel.query` into the LLM context and never reaches this function —
 * the split is a layer boundary, not a flag a caller can forget to set.
 */
export const projectToolViewModels = (
  messages: UIChatMessage[],
  resolve: ProjectorResolver = getToolProjector,
): UIChatMessage[] =>
  messages.map((message) => {
    const projected = message.role === 'tool' ? projectToolMessage(message, resolve) : message;

    // A query result can nest further message lists (compression groups,
    // parallel compare columns, group members). Their tool rows are the same
    // rows and deserve the same treatment.
    return {
      ...projected,
      ...(projected.columns?.length && {
        columns: projected.columns.map((column) => projectToolViewModels(column, resolve)),
      }),
      ...(projected.compressedMessages?.length && {
        compressedMessages: projectToolViewModels(projected.compressedMessages, resolve),
      }),
      ...(projected.members?.length && {
        members: projectToolViewModels(projected.members, resolve),
      }),
    };
  });
