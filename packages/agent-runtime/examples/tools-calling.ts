// @ts-nocheck
import OpenAI from 'openai';

import type { Agent, AgentRuntimeContext, AgentState } from '../src';
import { AgentRuntime } from '../src';

// OpenAI 模型运行时
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

// 简单的 Agent 实现
class SimpleAgent implements Agent {
  private conversationState: 'waiting_user' | 'processing_llm' | 'executing_tools' | 'done' =
    'waiting_user';
  private pendingToolCalls: any[] = [];

  // Agent 拥有自己的模型运行时
  modelRuntime = openaiRuntime;

  // 定义可用工具
  tools = {
    calculate: async ({ expression }: { expression: string }) => {
      try {
        // 注意：实际应用中应使用安全的数学解析器
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

  // 获取工具定义
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

  // Agent 决策逻辑 - 基于执行阶段和上下文
  async runner(context: AgentRuntimeContext, state: AgentState) {
    console.log(`[${context.phase}] 对话状态: ${this.conversationState}`);

    switch (context.phase) {
      case 'init': {
        // 初始化阶段
        this.conversationState = 'waiting_user';
        return { reason: 'No action needed', type: 'finish' as const };
      }

      case 'user_input': {
        // 用户输入阶段
        const userPayload = context.payload as { isFirstMessage: boolean; message: any };
        console.log(`👤 用户消息: ${userPayload.message.content}`);

        // 只有在等待用户输入状态时才处理
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

        // 其他状态下不处理用户输入，结束对话
        console.log(`⚠️ 忽略用户输入，当前状态: ${this.conversationState}`);
        return {
          reason: `Not in waiting_user state: ${this.conversationState}`,
          type: 'finish' as const,
        };
      }

      case 'llm_result': {
        // LLM 结果阶段，检查是否需要工具调用
        const llmPayload = context.payload as { hasToolCalls: boolean; result: any };

        // 手动添加 assistant 消息到状态中（修复 Runtime 的问题）
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

          // 添加包含 tool_calls 的 assistant 消息
          state.messages.push(assistantMessage);

          // 执行第一个工具调用
          return {
            toolCall: toolCalls[0],
            type: 'call_tool' as const,
          };
        }

        // 没有工具调用，添加普通 assistant 消息
        state.messages.push(assistantMessage);
        this.conversationState = 'done';
        return { reason: 'LLM response completed', type: 'finish' as const };
      }

      case 'tool_result': {
        // 工具执行结果阶段
        const toolPayload = context.payload as { result: any; toolMessage: any };
        console.log(`🛠️ 工具执行完成: ${JSON.stringify(toolPayload.result)}`);

        // 移除已执行的工具
        this.pendingToolCalls = this.pendingToolCalls.slice(1);

        // 如果还有未执行的工具，继续执行
        if (this.pendingToolCalls.length > 0) {
          return {
            toolCall: this.pendingToolCalls[0],
            type: 'call_tool' as const,
          };
        }

        // 所有工具执行完成，调用 LLM 处理结果
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
        // 人机交互响应阶段（简化示例中不使用）
        return { reason: 'Human interaction not supported', type: 'finish' as const };
      }

      case 'error': {
        // 错误阶段
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

// 主函数
async function main() {
  console.log('🚀 简单的 OpenAI Tools Agent 示例\n');

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ 请设置 OPENAI_API_KEY 环境变量');
    return;
  }

  // 创建 Agent 和 Runtime
  const agent = new SimpleAgent();
  const runtime = new AgentRuntime(agent); // modelRuntime 现在在 Agent 中

  // 测试消息
  const testMessage = process.argv[2] || 'What time is it? Also calculate 15 * 8 + 7';
  console.log(`💬 用户: ${testMessage}\n`);

  // 创建初始状态
  let state = AgentRuntime.createInitialState({
    maxSteps: 10,
    messages: [{ content: testMessage, role: 'user' }],
    sessionId: 'simple-test',
  });

  console.log('🤖 AI: ');

  // 执行对话循环
  let nextContext: AgentRuntimeContext | undefined = undefined;

  while (state.status !== 'done' && state.status !== 'error') {
    const result = await runtime.step(state, nextContext);

    // 处理事件
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
    nextContext = result.nextContext; // 使用返回的 nextContext
  }

  console.log(`\n📊 总共执行了 ${state.stepCount} 个步骤`);
}

main().catch(console.error);
