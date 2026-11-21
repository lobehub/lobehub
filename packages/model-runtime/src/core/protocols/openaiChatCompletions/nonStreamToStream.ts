import type OpenAI from 'openai';

/**
 * make the OpenAI response data as a stream
 */
export const transformResponseToStream = (data: OpenAI.ChatCompletion) =>
  new ReadableStream({
    start(controller) {
      const choices = data.choices || [];
      const first = choices[0];
      // Compatibility: Non-streaming responses from DeepSeek etc. put "deep thinking" in message.reasoning_content
      const message: any = first?.message ?? {};
      const reasoningText =
        typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0
          ? message.reasoning_content
          : null;
      if (reasoningText) {
        controller.enqueue({
          choices: [
            {
              delta: { content: null, reasoning_content: reasoningText, role: 'assistant' },
              finish_reason: null,
              index: first?.index ?? 0,
              logprobs: first?.logprobs ?? null,
            },
          ],
          created: data.created,
          id: data.id,
          model: data.model,
          object: 'chat.completion.chunk',
        } as unknown as OpenAI.ChatCompletionChunk);
      }
      const chunk: OpenAI.ChatCompletionChunk = {
        choices: choices.map((choice: OpenAI.ChatCompletion.Choice) => ({
          delta: {
            content: choice.message.content,
            role: choice.message.role,
            tool_calls: choice.message.tool_calls?.map(
              (tool, index): OpenAI.ChatCompletionChunk.Choice.Delta.ToolCall => {
                // OpenAI SDK v6 made tool calls a function|custom union; lobehub only emits function calls.
                const fnTool = tool as OpenAI.ChatCompletionMessageFunctionToolCall;
                return {
                  function: fnTool.function,
                  id: fnTool.id,
                  index,
                  type: fnTool.type,
                };
              },
            ),
          },
          finish_reason: null,
          index: choice.index,
          logprobs: choice.logprobs,
        })),
        created: data.created,
        id: data.id,
        model: data.model,
        object: 'chat.completion.chunk',
      };

      controller.enqueue(chunk);
      if (data.usage) {
        controller.enqueue({
          choices: [],
          created: data.created,
          id: data.id,
          model: data.model,
          object: 'chat.completion.chunk',
          usage: data.usage,
        } as unknown as OpenAI.ChatCompletionChunk);
      }
      controller.enqueue({
        choices: choices.map((choice: OpenAI.ChatCompletion.Choice) => ({
          delta: {
            content: null,
            role: choice.message.role,
          },
          finish_reason: choice.finish_reason,
          index: choice.index,
          logprobs: choice.logprobs,
        })),
        created: data.created,
        id: data.id,
        model: data.model,
        object: 'chat.completion.chunk',
        system_fingerprint: data.system_fingerprint,
      } as OpenAI.ChatCompletionChunk);
      controller.close();
    },
  });
