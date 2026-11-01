/**
 * LLM Mock Framework
 *
 * Intercepts /webapi/chat/[provider] requests and returns mock SSE responses.
 * This allows E2E tests to run without real LLM API calls.
 */
import type { Page } from 'playwright';

// ============================================
// Types
// ============================================

export interface LLMMockConfig {
  /** Default response content when no specific mock is set */
  defaultResponse: string;
  /** Whether to enable LLM mocking */
  enabled: boolean;
  /** Response delay in ms (simulates network latency) */
  responseDelay: number;
  /** Chunk size for streaming (characters per chunk) */
  streamChunkSize: number;
  /** Delay between chunks in ms */
  streamDelay: number;
}

export interface ChatMessage {
  content: string;
  role: 'user' | 'assistant' | 'system';
}

interface LLMStreamPlan {
  chunks: string[];
  responseDelay: number;
  streamDelay: number;
}

const LLM_MOCK_BINDING = '__lobehubE2ELLMMock';

// ============================================
// Default Configuration
// ============================================

const defaultConfig: LLMMockConfig = {
  defaultResponse: 'Hello! I am a mock AI assistant. How can I help you today?',
  enabled: true,
  responseDelay: 100,
  streamChunkSize: 10,
  streamDelay: 20,
};

// ============================================
// SSE Response Builder
// ============================================

/**
 * Build SSE formatted response chunks
 * Follows LobeChat's actual streaming format
 */
export function buildSSEChunks(content: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  const id = `msg_mock_${Date.now()}`;

  // Initial message data
  const initialData = {
    content: [],
    id,
    model: 'gpt-4o-mini',
    role: 'assistant',
    stop_reason: null,
    stop_sequence: null,
    type: 'message',
    usage: { input_tokens: 10, output_tokens: 0 },
  };
  chunks.push(`id: ${id}\nevent: data\ndata: ${JSON.stringify(initialData)}\n\n`);

  // Split content into chunks and send as text events
  for (let i = 0; i < content.length; i += chunkSize) {
    const chunk = content.slice(i, i + chunkSize);
    chunks.push(`id: ${id}\nevent: text\ndata: ${JSON.stringify(chunk)}\n\n`);
  }

  // Stop event
  chunks.push(`id: ${id}\nevent: stop\ndata: "end_turn"\n\n`);

  // Usage event
  const usageData = {
    cost: 0.0001,
    inputCacheMissTokens: 10,
    inputCachedTokens: 0,
    totalInputTokens: 10,
    totalOutputTokens: Math.ceil(content.length / 4),
    totalTokens: 10 + Math.ceil(content.length / 4),
  };
  chunks.push(
    `id: ${id}\nevent: usage\ndata: ${JSON.stringify(usageData)}\n\n`,
    `id: ${id}\nevent: stop\ndata: "message_stop"\n\n`,
  );

  return chunks;
}

// ============================================
// LLM Mock Manager
// ============================================

export class LLMMockManager {
  private config: LLMMockConfig;
  private customResponseFragments: Map<string, string> = new Map();
  private customResponses: Map<string, string> = new Map();

  constructor(config: Partial<LLMMockConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Set a custom response for a specific user message
   */
  setResponse(userMessage: string, response: string): void {
    this.customResponses.set(userMessage.toLowerCase().trim(), response);
  }

  /**
   * Set a response for requests whose final user message contains a fragment.
   * Useful for system-generated prompts that wrap the original user content.
   */
  setResponseContaining(userMessageFragment: string, response: string): void {
    this.customResponseFragments.set(userMessageFragment.toLowerCase().trim(), response);
  }

  /**
   * Merge partial config overrides. Used by tests that need a slower or faster
   * stream than the defaults (e.g. to simulate mid-stream user interactions).
   */
  setConfig(partial: Partial<LLMMockConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /**
   * Reset config to factory defaults. Call from `After` hooks so a test's
   * timing overrides do not bleed into the next scenario.
   */
  resetConfig(): void {
    this.config = { ...defaultConfig };
  }

  /**
   * Clear all custom responses
   */
  clearResponses(): void {
    this.customResponses.clear();
    this.customResponseFragments.clear();
  }

  /**
   * Get response for a user message
   */
  private getResponse(messages: ChatMessage[]): string {
    // Find the last user message
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');

    if (lastUserMessage) {
      const key = lastUserMessage.content.toLowerCase().trim();
      if (this.customResponses.has(key)) {
        return this.customResponses.get(key)!;
      }

      for (const [fragment, response] of this.customResponseFragments) {
        if (key.includes(fragment)) return response;
      }
    }

    return this.config.defaultResponse;
  }

  /**
   * Setup LLM mock handlers for a page
   */
  async setup(page: Page): Promise<void> {
    if (!this.config.enabled) {
      console.log('   🔇 LLM mocks disabled');
      return;
    }

    await page.exposeFunction(LLM_MOCK_BINDING, (requestBody: string) =>
      this.createStreamPlan(requestBody),
    );

    // Playwright's route.fulfill buffers the entire body, so it cannot model
    // token-by-token SSE delivery. Install a browser-side fetch interceptor
    // that returns a real ReadableStream and honors the configured delays.
    // Use raw JavaScript instead of a function argument: tsx decorates named
    // functions with a module-scoped helper that does not exist in the page.
    await page.addInitScript({
      content: `
        (() => {
          if (window.__lobehubE2ELLMFetchInstalled) return;

          const bindingName = ${JSON.stringify(LLM_MOCK_BINDING)};
          const originalFetch = window.fetch.bind(window);
          const abortError = () => new DOMException('The operation was aborted', 'AbortError');
          const wait = (delay, signal) =>
            new Promise((resolve, reject) => {
              if (signal.aborted) {
                reject(signal.reason || abortError());
                return;
              }

              if (delay <= 0) {
                resolve();
                return;
              }

              const onAbort = () => {
                window.clearTimeout(timeout);
                reject(signal.reason || abortError());
              };
              const timeout = window.setTimeout(() => {
                signal.removeEventListener('abort', onAbort);
                resolve();
              }, delay);

              signal.addEventListener('abort', onAbort, { once: true });
            });

          window.fetch = async (input, init) => {
            const normalizedInput =
              input instanceof Request ? input : new URL(String(input), window.location.href);
            const request = new Request(normalizedInput, init);
            const url = new URL(request.url);

            if (!url.pathname.startsWith('/webapi/chat/')) {
              return originalFetch(input, init);
            }

            const createStreamPlan = window[bindingName];
            if (!createStreamPlan) throw new Error('LLM mock binding is not available');

            const plan = await createStreamPlan(await request.clone().text());
            await wait(plan.responseDelay, request.signal);

            const encoder = new TextEncoder();
            let cancelled = false;
            const body = new ReadableStream({
              cancel() {
                cancelled = true;
              },
              start(controller) {
                void (async () => {
                  try {
                    for (let index = 0; index < plan.chunks.length; index += 1) {
                      if (cancelled) return;
                      if (request.signal.aborted) throw request.signal.reason || abortError();

                      controller.enqueue(encoder.encode(plan.chunks[index]));

                      if (index < plan.chunks.length - 1) {
                        await wait(plan.streamDelay, request.signal);
                      }
                    }

                    if (!cancelled) controller.close();
                  } catch (error) {
                    if (!cancelled) controller.error(error);
                  }
                })();
              },
            });

            return new Response(body, {
              headers: {
                'Cache-Control': 'no-cache',
                'Content-Type': 'text/event-stream',
              },
              status: 200,
            });
          };

          window.__lobehubE2ELLMFetchInstalled = true;
        })();
      `,
    });

    console.log('   ✓ LLM mocks registered (all providers)');
  }

  /**
   * Build the stream plan requested by the browser-side fetch interceptor.
   */
  private createStreamPlan(requestBody: string): LLMStreamPlan {
    const body = JSON.parse(requestBody) as { messages?: ChatMessage[] };
    const messages = body.messages || [];

    console.log(`   🤖 LLM Request intercepted (${messages.length} messages)`);

    const responseContent = this.getResponse(messages);
    const chunks = buildSSEChunks(responseContent, this.config.streamChunkSize);

    console.log(`   ✅ LLM Response streaming (${responseContent.length} chars)`);

    return {
      chunks,
      responseDelay: this.config.responseDelay,
      streamDelay: this.config.streamDelay,
    };
  }

  /**
   * Disable LLM mocking
   */
  disable(): void {
    this.config.enabled = false;
  }

  /**
   * Enable LLM mocking
   */
  enable(): void {
    this.config.enabled = true;
  }
}

// ============================================
// Singleton Instance
// ============================================

export const llmMockManager = new LLMMockManager();

// ============================================
// Preset Responses
// ============================================

export const presetResponses = {
  codeHelp: 'I can help you with coding! Please share the code you would like me to review.',
  error: 'I apologize, but I encountered an error processing your request.',
  greeting: 'Hello! I am Lobe AI, your AI assistant. How can I help you today?',

  // Much longer response so the chat surely exceeds the viewport and scroll
  // behavior is observable (used by @AGENT-SCROLL-* scenarios).
  longScrollArticle: Array.from({ length: 30 }, (_, i) => `这是第 ${i + 1} 段内容。`)
    .concat(
      Array.from(
        { length: 30 },
        (_, i) =>
          `段落 ${i + 1}：人工智能是计算机科学的一个分支，它企图了解智能的实质，并生产出一种新的能以人类智能相似的方式做出反应的智能机器。研究领域包括机器人、语言识别、图像识别、自然语言处理和专家系统等。`,
      ),
    )
    .join('\n\n'),

  // Long response for stop generation test
  longArticle:
    '这是一篇很长的文章。第一段：人工智能是计算机科学的一个分支，它企图了解智能的实质，并生产出一种新的能以人类智能相似的方式做出反应的智能机器。第二段：人工智能研究的主要目标包括推理、知识、规划、学习、自然语言处理、感知和移动与操控物体的能力。第三段：目前，人工智能已经在许多领域取得了重大突破，包括图像识别、语音识别、自然语言处理等。',

  // Multi-turn conversation responses
  nameIntro: '好的，我记住了，你的名字是小明。很高兴认识你，小明！有什么我可以帮助你的吗？',

  nameRecall: '你刚才说你的名字是小明。',
  // Regenerate response
  regenerated: '这是重新生成的回复内容。我是 Lobe AI，很高兴为你服务！',
};
