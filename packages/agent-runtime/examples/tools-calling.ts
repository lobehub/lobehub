// @ts-nocheck
import OpenAI from 'openai';

import type { Agent, AgentRuntimeContext, AgentState } from '../src';
import { AgentRuntime } from '../src';

// OpenAI model runtime
async function* openaiRuntime(payload: any) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
  });

  const { messages, tools } = payload;

  const stream = await openai.chat.completions.create({
    messages,
    model: 'gpt-4.1-mini',
    stream: true,
    tools,
  });

  let content = '';
  const toolCalls: any[] = [];

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;

    if (delta?.content) {
      content += delta.content;
      yield { content };
    }

    if (delta?.tool_calls) {
      for (const toolCall of delta.tool_calls) {
        if (!toolCalls[toolCall.index]) {
          toolCalls[toolCall.index] = {
            function: { arguments: '', name: '' },
            id: toolCall.id,
            type: 'function',
          };
        }
        if (toolCall.function?.name) {
          toolCalls[toolCall.index].function.name += toolCall.function.name;
        }
        if (toolCall.function?.arguments) {
          toolCalls[toolCall.index].function.arguments += toolCall.function.arguments;
        }
      }
    }
  }

  if (toolCalls.length > 0) {
    yield { tool_calls: toolCalls.filter(Boolean) };
  }
}

// Simple Agent implementation
class SimpleAgent implements Agent {
  private conversationState: 'waiting_user' | 'processing_llm' | 'executing_tools' | 'done' =
    'waiting_user';
  private pendingToolCalls: any[] = [];

  // Agent has its own model runtime
  modelRuntime = openaiRuntime;

  // Define available tools
  tools = {
    calculate: async ({ expression }: { expression: string }) => {
      try {
        // Note: In production, use a secure math expression parser
        const result = new Function(`"use strict"; return (${expression})`)();
        return { expression, result };
      } catch {
        return { error: 'Invalid expression', expression };
      }
    },

    get_time: async () => {
      return {
        current_time: new Date().toISOString(),
        formatted_time: new Date().toLocaleString(),
      };
    },
  };

  // Get tool definitions
  private getToolDefinitions() {
    return [
      {
        function: {
          description: 'Get current date and time',
          name: 'get_time',
          parameters: { properties: {}, type: 'object' },
        },
        type: 'function' as const,
      },
      {
        function: {
          description: 'Calculate mathematical expressions',
          name: 'calculate',
          parameters: {
            properties: {
              expression: { description: 'Math expression', type: 'string' },
            },
            required: ['expression'],
            type: 'object',
          },
        },
        type: 'function' as const,
      },
    ];
  }

  // Agent decision logic - based on execution phase and context
  async runner(context: AgentRuntimeContext, state: AgentState) {
    console.log(`[${context.phase}] 对话状态: ${this.conversationState}`);

    switch (context.phase) {
      case 'init': {
        // Initialization phase
        this.conversationState = 'waiting_user';
        return { reason: 'No action needed', type: 'finish' as const };
      }

      case 'user_input': {
        // User input phase
        const userPayload = context.payload as { isFirstMessage: boolean; message: any };
        console.log(`👤 用户消息: ${userPayload.message.content}`);

        // Only process when in waiting_user state
        if (this.conversationState === 'waiting_user') {
          this.conversationState = 'processing_llm';
          return {
            payload: {
              messages: state.messages,
              tools: this.getToolDefinitions(),
            },
            type: 'call_llm' as const,
          };
        }

        // Do not process user input in other states, end conversation
        console.log(`⚠️ 忽略用户输入，当前状态: ${this.conversationState}`);
        return {
          reason: `Not in waiting_user state: ${this.conversationState}`,
          type: 'finish' as const,
        };
      }

      case 'llm_result': {
        // LLM result phase, check if tool calls are needed
        const llmPayload = context.payload as { hasToolCalls: boolean; result: any };

        // Manually add assistant message to state (fixes a Runtime issue)
        const assistantMessage: any = {
          content: llmPayload.result.content || null,
          role: 'assistant',
        };

        if (llmPayload.hasToolCalls) {
          const toolCalls = llmPayload.result.tool_calls;
          assistantMessage.tool_calls = toolCalls;
          this.pendingToolCalls = toolCalls;
          this.conversationState = 'executing_tools';

          console.log(
            '🔧 需要执行工具:',
            toolCalls.map((call: any) => call.function.name),
          );

          // Add assistant message containing tool_calls
          state.messages.push(assistantMessage);

          // Execute the first tool call
          return {
            toolCall: toolCalls[0],
            type: 'call_tool' as const,
          };
        }

        // No tool calls, add regular assistant message
        state.messages.push(assistantMessage);
        this.conversationState = 'done';
        return { reason: 'LLM response completed', type: 'finish' as const };
      }

      case 'tool_result': {
        // Tool execution result phase
        const toolPayload = context.payload as { result: any; toolMessage: any };
        console.log(`🛠️ 工具执行完成: ${JSON.stringify(toolPayload.result)}`);

        // Remove the executed tool
        this.pendingToolCalls = this.pendingToolCalls.slice(1);

        // If there are more pending tools, continue execution
        if (this.pendingToolCalls.length > 0) {
          return {
            toolCall: this.pendingToolCalls[0],
            type: 'call_tool' as const,
          };
        }

        // All tools executed, call LLM to process results
        this.conversationState = 'processing_llm';
        return {
          payload: {
            messages: state.messages,
            tools: this.getToolDefinitions(),
          },
          type: 'call_llm' as const,
        };
      }

      case 'human_response': {
        // Human interaction response phase (not used in this simplified example)
        return { reason: 'Human interaction not supported', type: 'finish' as const };
      }

      case 'error': {
        // Error phase
        const errorPayload = context.payload as { error: any };
        console.error('❌ 错误状态:', errorPayload.error);
        return { reason: 'Error occurred', type: 'finish' as const };
      }

      default: {
        return { reason: 'Unknown phase', type: 'finish' as const };
      }
    }
  }
}

// Main function
async function main() {
  console.log('🚀 简单的 OpenAI Tools Agent 示例\n');

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ 请设置 OPENAI_API_KEY 环境变量');
    return;
  }

  // Create Agent and Runtime
  const agent = new SimpleAgent();
  const runtime = new AgentRuntime(agent); // modelRuntime is now in Agent

  // Test message
  const testMessage = process.argv[2] || 'What time is it? Also calculate 15 * 8 + 7';
  console.log(`💬 用户: ${testMessage}\n`);

  // Create initial state
  let state = AgentRuntime.createInitialState({
    maxSteps: 10,
    messages: [{ content: testMessage, role: 'user' }],
    sessionId: 'simple-test',
  });

  console.log('🤖 AI: ');

  // Execute conversation loop
  let nextContext: AgentRuntimeContext | undefined = undefined;

  while (state.status !== 'done' && state.status !== 'error') {
    const result = await runtime.step(state, nextContext);

    // Process events
    for (const event of result.events) {
      switch (event.type) {
        case 'llm_stream': {
          if ((event as any).chunk.content) {
            process.stdout.write((event as any).chunk.content);
          }
          break;
        }
        case 'llm_result': {
          if ((event as any).result.tool_calls) {
            console.log('\n\n🔧 需要调用工具...');
          }
          break;
        }
        case 'tool_result': {
          console.log(`\n🛠️ 工具执行结果:`, event.result);
          console.log('\n🤖 AI: ');
          break;
        }
        case 'done': {
          console.log('\n\n✅ 对话完成');
          break;
        }
        case 'error': {
          console.error('\n❌ 错误:', event.error);
          break;
        }
      }
    }

    state = result.newState;
    nextContext = result.nextContext; // use the returned nextContext
  }

  console.log(`\n📊 总共执行了 ${state.stepCount} 个步骤`);
}

main().catch(console.error);
