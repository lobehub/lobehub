import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { BaseProvider } from '../BaseProvider';

class TestProvider extends BaseProvider {
  readonly name = 'TestProvider';

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    return context;
  }
}

class ContextBuildingProvider extends BaseProvider {
  readonly name = 'ContextBuildingProvider';

  protected async buildContext(_context: PipelineContext): Promise<string | null> {
    return 'Test context content';
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const content = await this.buildContext(context);
    if (content && this.shouldInject(context)) {
      const systemMessage = this.createSystemMessage(content);
      return {
        ...context,
        messages: [systemMessage, ...context.messages],
      };
    }
    return context;
  }
}

class ConditionalProvider extends BaseProvider {
  readonly name = 'ConditionalProvider';

  constructor(private shouldInjectFlag: boolean) {
    super();
  }

  protected shouldInject(_context: PipelineContext): boolean {
    return this.shouldInjectFlag;
  }

  protected async buildContext(_context: PipelineContext): Promise<string | null> {
    return 'Conditional content';
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const content = await this.buildContext(context);
    if (content && this.shouldInject(context)) {
      const systemMessage = this.createSystemMessage(content);
      return {
        ...context,
        messages: [systemMessage, ...context.messages],
      };
    }
    return context;
  }
}

class NullContextProvider extends BaseProvider {
  readonly name = 'NullContextProvider';

  protected async buildContext(_context: PipelineContext): Promise<string | null> {
    return null;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const content = await this.buildContext(context);
    if (content) {
      const systemMessage = this.createSystemMessage(content);
      return {
        ...context,
        messages: [systemMessage, ...context.messages],
      };
    }
    return context;
  }
}

describe('BaseProvider', () => {
  const createContext = (messages: any[] = []): PipelineContext => ({
    initialState: {
      messages: [],
      model: 'test-model',
      provider: 'test-provider',
    },
    isAborted: false,
    messages,
    metadata: {
      maxTokens: 4000,
      model: 'test-model',
    },
  });

  describe('constructor', () => {
    it('should initialize with options', () => {
      const provider = new TestProvider({ debug: true });
      expect(provider.name).toBe('TestProvider');
    });

    it('should initialize without options', () => {
      const provider = new TestProvider();
      expect(provider.name).toBe('TestProvider');
    });
  });

  describe('buildContext', () => {
    it('should return null by default', async () => {
      const provider = new TestProvider();
      const context = createContext();

      // Access protected method through a derived class
      class AccessibleProvider extends TestProvider {
        async testBuildContext(ctx: PipelineContext) {
          return this.buildContext(ctx);
        }
      }

      const accessibleProvider = new AccessibleProvider();
      const result = await accessibleProvider.testBuildContext(context);

      expect(result).toBeNull();
    });

    it('should allow override to return content', async () => {
      const provider = new ContextBuildingProvider();
      const context = createContext([{ content: 'user message', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toBe('Test context content');
      expect(result.messages[1].content).toBe('user message');
    });

    it('should allow returning null to skip injection', async () => {
      const provider = new NullContextProvider();
      const context = createContext([{ content: 'user message', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('user message');
    });
  });

  describe('shouldInject', () => {
    it('should return true by default', async () => {
      const provider = new TestProvider();
      const context = createContext();

      // Access protected method
      class AccessibleProvider extends TestProvider {
        testShouldInject(ctx: PipelineContext) {
          return this.shouldInject(ctx);
        }
      }

      const accessibleProvider = new AccessibleProvider();
      const result = accessibleProvider.testShouldInject(context);

      expect(result).toBe(true);
    });

    it('should allow override to control injection', async () => {
      const provider1 = new ConditionalProvider(true);
      const provider2 = new ConditionalProvider(false);

      const context = createContext([{ content: 'test', role: 'user' }]);

      const result1 = await provider1.process(context);
      const result2 = await provider2.process(context);

      expect(result1.messages).toHaveLength(2);
      expect(result1.messages[0].role).toBe('system');

      expect(result2.messages).toHaveLength(1);
      expect(result2.messages[0].role).toBe('user');
    });
  });

  describe('createSystemMessage', () => {
    it('should create system message with content', async () => {
      const provider = new TestProvider();

      // Access protected method
      class AccessibleProvider extends TestProvider {
        testCreateSystemMessage(content: string) {
          return this.createSystemMessage(content);
        }
      }

      const accessibleProvider = new AccessibleProvider();
      const message = accessibleProvider.testCreateSystemMessage('Test system prompt');

      expect(message).toEqual({
        content: 'Test system prompt',
        role: 'system',
      });
    });

    it('should handle empty content', async () => {
      class AccessibleProvider extends TestProvider {
        testCreateSystemMessage(content: string) {
          return this.createSystemMessage(content);
        }
      }

      const provider = new AccessibleProvider();
      const message = provider.testCreateSystemMessage('');

      expect(message).toEqual({
        content: '',
        role: 'system',
      });
    });

    it('should handle multiline content', async () => {
      class AccessibleProvider extends TestProvider {
        testCreateSystemMessage(content: string) {
          return this.createSystemMessage(content);
        }
      }

      const provider = new AccessibleProvider();
      const content = 'Line 1\nLine 2\nLine 3';
      const message = provider.testCreateSystemMessage(content);

      expect(message).toEqual({
        content,
        role: 'system',
      });
    });
  });

  describe('integration scenarios', () => {
    it('should work with full provider pattern', async () => {
      class FullProvider extends BaseProvider {
        readonly name = 'FullProvider';

        protected async buildContext(context: PipelineContext): Promise<string | null> {
          if (context.initialState.systemRole) {
            return `System: ${context.initialState.systemRole}`;
          }
          return null;
        }

        protected shouldInject(context: PipelineContext): boolean {
          return context.messages.length > 0;
        }

        protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
          const cloned = this.cloneContext(context);
          const content = await this.buildContext(context);

          if (content && this.shouldInject(context)) {
            const systemMessage = this.createSystemMessage(content);
            cloned.messages = [systemMessage, ...cloned.messages];
          }

          return cloned;
        }
      }

      const provider = new FullProvider();
      const context = createContext([{ content: 'hello', role: 'user' }]);
      context.initialState.systemRole = 'You are a helpful assistant';

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toBe('System: You are a helpful assistant');
      expect(result.messages[1].content).toBe('hello');
    });

    it('should skip injection when shouldInject returns false', async () => {
      class SkipProvider extends BaseProvider {
        readonly name = 'SkipProvider';

        protected async buildContext(_context: PipelineContext): Promise<string | null> {
          return 'System prompt';
        }

        protected shouldInject(context: PipelineContext): boolean {
          return context.messages.length > 1;
        }

        protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
          const cloned = this.cloneContext(context);
          const content = await this.buildContext(context);

          if (content && this.shouldInject(context)) {
            const systemMessage = this.createSystemMessage(content);
            cloned.messages = [systemMessage, ...cloned.messages];
          }

          return cloned;
        }
      }

      const provider = new SkipProvider();
      const context = createContext([{ content: 'hello', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
    });

    it('should handle complex context building', async () => {
      class ComplexProvider extends BaseProvider {
        readonly name = 'ComplexProvider';

        protected async buildContext(context: PipelineContext): Promise<string | null> {
          const { model, provider } = context.initialState;
          const { maxTokens } = context.metadata;

          return `Model: ${model}, Provider: ${provider}, Max Tokens: ${maxTokens}`;
        }

        protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
          const cloned = this.cloneContext(context);
          const content = await this.buildContext(context);

          if (content && this.shouldInject(context)) {
            const systemMessage = this.createSystemMessage(content);
            cloned.messages = [systemMessage, ...cloned.messages];
          }

          return cloned;
        }
      }

      const provider = new ComplexProvider();
      const context = createContext([{ content: 'test', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe(
        'Model: test-model, Provider: test-provider, Max Tokens: 4000',
      );
    });
  });

  describe('inheritance from BaseProcessor', () => {
    it('should inherit all BaseProcessor functionality', async () => {
      class InheritanceTestProvider extends BaseProvider {
        readonly name = 'InheritanceTest';

        protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
          const cloned = this.cloneContext(context);

          // Use inherited methods
          if (cloned.messages.length === 0) {
            return this.abort(cloned, 'No messages');
          }

          const firstContent = cloned.messages[0].content;
          if (this.isEmptyMessage(typeof firstContent === 'string' ? firstContent : undefined)) {
            return this.abort(cloned, 'Empty message');
          }

          return this.markAsExecuted(cloned);
        }
      }

      const provider = new InheritanceTestProvider();

      // Test with empty messages
      const context1 = createContext([]);
      const result1 = await provider.process(context1);
      expect(result1.isAborted).toBe(true);
      expect(result1.abortReason).toBe('No messages');

      // Test with empty content
      const context2 = createContext([{ content: '', role: 'user' }]);
      const result2 = await provider.process(context2);
      expect(result2.isAborted).toBe(true);
      expect(result2.abortReason).toBe('Empty message');

      // Test with valid content
      const context3 = createContext([{ content: 'hello', role: 'user' }]);
      const result3 = await provider.process(context3);
      expect(result3.isAborted).toBe(false);
    });
  });
});
