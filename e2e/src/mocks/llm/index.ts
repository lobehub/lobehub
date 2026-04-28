/**
 * LLM Mock Framework
 *
 * Intercepts /webapi/chat/[provider] requests and returns mock SSE responses.
 * This allows E2E tests to run without real LLM API calls.
 */
import type { Page, Route } from 'playwright';

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
function buildSSEChunks(content: string, chunkSize: number): string[] {
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
    chunks.push(`id: ${id}\nevent: text\ndata: "${chunk.replaceAll('"', '\\"')}"\n\n`);
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
  private customResponses: Map<string, string> = new Map();
  private page: Page | null = null;

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
    }

    return this.config.defaultResponse;
  }

  /**
   * Setup LLM mock handlers for a page
   */
  async setup(page: Page): Promise<void> {
    this.page = page;

    if (!this.config.enabled) {
      console.log('   🔇 LLM mocks disabled');
      return;
    }

    // Intercept all LLM chat API requests (openai, anthropic, etc.)
    await page.route('**/webapi/chat/**', async (route) => {
      await this.handleChatRequest(route);
    });

    console.log('   ✓ LLM mocks registered (all providers)');
  }

  /**
   * Handle intercepted chat request
   */
  private async handleChatRequest(route: Route): Promise<void> {
    const request = route.request();

    try {
      // Parse request body
      const body = request.postDataJSON();
      const messages: ChatMessage[] = body?.messages || [];

      console.log(`   🤖 LLM Request intercepted (${messages.length} messages)`);

      // Get response content
      const responseContent = this.getResponse(messages);

      // Build SSE chunks
      const chunks = buildSSEChunks(responseContent, this.config.streamChunkSize);

      // Simulate initial delay
      await new Promise((resolve) => {
        setTimeout(resolve, this.config.responseDelay);
      });

      // Create streaming response
      const stream = chunks.join('');

      await route.fulfill({
        body: stream,
        headers: {
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Content-Type': 'text/event-stream',
        },
        status: 200,
      });

      console.log(`   ✅ LLM Response sent (${responseContent.length} chars)`);
    } catch (error) {
      console.error('   ❌ LLM Mock error:', error);
      await route.fulfill({
        body: JSON.stringify({ error: 'Mock error' }),
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      });
    }
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
