import type OpenAI from 'openai';

/**
 * transform the OpenAI Response API data to stream format for non-streaming responses
 */
export const transformResponseAPIToStream = (data: OpenAI.Responses.Response) =>
  new ReadableStream({
    start(controller) {
      // Check if output exists and is an array
      if (data.output && Array.isArray(data.output)) {
        data.output.forEach((output, outputIndex) => {
          switch (output.type) {
            case 'message': {
              // Check if content exists and is an array
              if (output.content && Array.isArray(output.content)) {
                output.content.forEach((content) => {
                  switch (content.type) {
                    case 'output_text': {
                      // Only emit delta if text exists
                      if (content.text) {
                        controller.enqueue({
                          delta: content.text,
                          type: 'response.output_text.delta',
                        });
                      }
                      break;
                    }
                  }
                });
              }
              break;
            }
            case 'reasoning': {
              if (output.encrypted_content) {
                controller.enqueue({
                  item: output,
                  output_index: outputIndex,
                  sequence_number: outputIndex,
                  type: 'response.output_item.done',
                } as OpenAI.Responses.ResponseOutputItemDoneEvent);
              }
              break;
            }
            /**
             * A completed tool call already carries its full arguments/input. The stream parser
             * reads them from `output_item.added`, so no argument deltas are needed; dropping
             * this item would turn a tool-call-only response into an empty completion.
             */
            case 'custom_tool_call':
            case 'function_call': {
              controller.enqueue({
                item: output,
                output_index: outputIndex,
                sequence_number: outputIndex,
                type: 'response.output_item.added',
              } as OpenAI.Responses.ResponseOutputItemAddedEvent);
              break;
            }
          }
        });
      }

      // Always send response.completed event
      controller.enqueue({
        response: data,
        sequence_number: 999,
        type: 'response.completed',
      } as OpenAI.Responses.ResponseStreamEvent);

      controller.close();
    },
  });
