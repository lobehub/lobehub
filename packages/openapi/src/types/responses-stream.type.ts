import { z } from 'zod';

import {
  ResponseObjectSchema,
  ResponseOutputItemSchema,
  ResponseOutputTextSchema,
} from './responses.type';

// ==================== Streaming events ====================
//
// `POST /responses` with `stream: true` answers `text/event-stream`: each SSE
// message carries `event: <type>` and `data: <JSON event>`. These schemas type
// that JSON after the OpenResponses streaming events, narrowed to what
// `ResponsesService.createResponseStream` emits.

/** One event schema, registered as a named spec component (`ResponseCreatedEvent`). */
const event = <T extends z.ZodRawShape>(id: string, type: string, shape: T) =>
  z
    .object({
      /** Increases by one per event, starting at 0. */
      sequence_number: z.number().int().min(0),
      type: z.literal(type),
      ...shape,
    })
    .strict()
    .meta({ id });

const outputIndex = z.number().int().min(0);
const itemRef = { item_id: z.string(), output_index: outputIndex };
const textPart = { ...itemRef, content_index: z.number().int().min(0) };
const logprobs = ResponseOutputTextSchema.shape.logprobs;

/**
 * Every event `POST /responses` streams. Switch on `type`; the run is over after
 * `response.completed`, `response.failed` or `response.incomplete`.
 */
export const ResponseStreamEventSchema = z
  .discriminatedUnion('type', [
    event('ResponseCreatedEvent', 'response.created', { response: ResponseObjectSchema }),
    event('ResponseInProgressEvent', 'response.in_progress', { response: ResponseObjectSchema }),
    event('ResponseCompletedEvent', 'response.completed', { response: ResponseObjectSchema }),
    event('ResponseFailedEvent', 'response.failed', { response: ResponseObjectSchema }),
    event('ResponseIncompleteEvent', 'response.incomplete', { response: ResponseObjectSchema }),
    event('ResponseOutputItemAddedEvent', 'response.output_item.added', {
      item: ResponseOutputItemSchema,
      output_index: outputIndex,
    }),
    event('ResponseOutputItemDoneEvent', 'response.output_item.done', {
      item: ResponseOutputItemSchema,
      output_index: outputIndex,
    }),
    event('ResponseContentPartAddedEvent', 'response.content_part.added', {
      ...textPart,
      part: ResponseOutputTextSchema,
    }),
    event('ResponseContentPartDoneEvent', 'response.content_part.done', {
      ...textPart,
      part: ResponseOutputTextSchema,
    }),
    event('ResponseOutputTextDeltaEvent', 'response.output_text.delta', {
      ...textPart,
      delta: z.string(),
      logprobs,
    }),
    event('ResponseOutputTextDoneEvent', 'response.output_text.done', {
      ...textPart,
      logprobs,
      text: z.string(),
    }),
    event('ResponseFunctionCallArgumentsDeltaEvent', 'response.function_call_arguments.delta', {
      ...itemRef,
      delta: z.string(),
    }),
    event('ResponseFunctionCallArgumentsDoneEvent', 'response.function_call_arguments.done', {
      ...itemRef,
      /** The complete JSON-encoded arguments. */
      arguments: z.string(),
    }),
  ])
  .meta({ id: 'ResponseStreamEvent' });

export type ResponseStreamEventPayload = z.infer<typeof ResponseStreamEventSchema>;
