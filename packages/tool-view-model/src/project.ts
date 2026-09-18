import type { UIChatMessage } from '@lobechat/types';

import { getToolProjector } from './registry';
import type { ToolProjector } from './types';

/** Resolves the projector for one tool call. Injectable so the pipeline can be
 *  exercised without mutating the process-wide registry. */
export type ProjectorResolver = (
  identifier?: string | null,
  apiName?: string | null,
) => ToolProjector | undefined;

const projectToolMessage = (message: UIChatMessage, resolve: ProjectorResolver): UIChatMessage => {
  const projector = resolve(message.plugin?.identifier, message.plugin?.apiName);
  if (!projector) return message;

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
