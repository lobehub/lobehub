import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { ProcessorError } from '../../types';
import { BaseProcessor } from '../BaseProcessor';

class TestProcessor extends BaseProcessor {
  readonly name = 'TestProcessor';

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    return this.cloneContext(context);
  }
}

class AbortingProcessor extends BaseProcessor {
  readonly name = 'AbortingProcessor';

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    return this.abort(context, 'test abort reason');
  }
}

class InvalidOutputProcessor extends BaseProcessor {
  readonly name = 'InvalidOutputProcessor';

  protected async doProcess(_context: PipelineContext): Promise<PipelineContext> {
    return {} as PipelineContext;
  }
}

class ErrorThrowingProcessor extends BaseProcessor {
  readonly name = 'ErrorThrowingProcessor';

  protected async doProcess(_context: PipelineContext): Promise<PipelineContext> {
    throw new Error('test error');
  }
}

class MessageCheckingProcessor extends BaseProcessor {
  readonly name = 'MessageCheckingProcessor';
  public lastEmptyCheck: boolean | null = null;

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const cloned = this.cloneContext(context);

    // Test isEmptyMessage
    if (cloned.messages.length > 0) {
      const content = cloned.messages[0].content;
      this.lastEmptyCheck = this.isEmptyMessage(typeof content === 'string' ? content : undefined);
    }

    return this.markAsExecuted(cloned);
  }
}

describe('BaseProcessor', () => {
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
      const processor = new TestProcessor({ debug: true });
      expect(processor.name).toBe('TestProcessor');
    });

    it('should initialize without options', () => {
      const processor = new TestProcessor();
      expect(processor.name).toBe('TestProcessor');
    });
  });

  describe('process', () => {
    it('should process valid context', async () => {
      const processor = new TestProcessor();
      const context = createContext([{ content: 'test', role: 'user' }]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('test');
    });

    it('should validate input context', async () => {
      const processor = new TestProcessor();
      const invalidContext = { messages: 'not an array' } as any;

      await expect(processor.process(invalidContext)).rejects.toThrow(ProcessorError);
      await expect(processor.process(invalidContext)).rejects.toThrow('Invalid context');
    });

    it('should validate output context', async () => {
      const processor = new InvalidOutputProcessor();
      const context = createContext([{ content: 'test', role: 'user' }]);

      await expect(processor.process(context)).rejects.toThrow(ProcessorError);
      await expect(processor.process(context)).rejects.toThrow('Invalid output context');
    });

    it('should wrap errors in ProcessorError', async () => {
      const processor = new ErrorThrowingProcessor();
      const context = createContext();

      await expect(processor.process(context)).rejects.toThrow(ProcessorError);

      try {
        await processor.process(context);
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessorError);
        if (error instanceof ProcessorError) {
          expect(error.processorName).toBe('ErrorThrowingProcessor');
          expect(error.originalError).toBeInstanceOf(Error);
          expect(error.originalError?.message).toBe('test error');
        }
      }
    });

    it('should handle non-Error throws', async () => {
      class StringThrowingProcessor extends BaseProcessor {
        readonly name = 'StringThrowingProcessor';

        protected async doProcess(_context: PipelineContext): Promise<PipelineContext> {
          throw 'string error';
        }
      }

      const processor = new StringThrowingProcessor();
      const context = createContext();

      await expect(processor.process(context)).rejects.toThrow(ProcessorError);
    });
  });

  describe('validateInput', () => {
    it('should reject null context', async () => {
      const processor = new TestProcessor();

      await expect(processor.process(null as any)).rejects.toThrow('Invalid context');
    });

    it('should reject undefined context', async () => {
      const processor = new TestProcessor();

      await expect(processor.process(undefined as any)).rejects.toThrow('Invalid context');
    });

    it('should reject context without messages array', async () => {
      const processor = new TestProcessor();
      const invalidContext = {
        initialState: {},
        isAborted: false,
        metadata: {},
      } as any;

      await expect(processor.process(invalidContext)).rejects.toThrow('Invalid context');
    });
  });

  describe('cloneContext', () => {
    it('should create shallow copy of context', async () => {
      const processor = new TestProcessor();
      const context = createContext([
        { content: 'test1', role: 'user' },
        { content: 'test2', role: 'assistant' },
      ]);

      const result = await processor.process(context);

      expect(result).not.toBe(context);
      expect(result.messages).not.toBe(context.messages);
      expect(result.metadata).not.toBe(context.metadata);
      expect(result.initialState).toBe(context.initialState); // initialState is readonly, so it's shared
    });

    it('should preserve all context properties', async () => {
      const processor = new TestProcessor();
      const context = createContext([{ content: 'test', role: 'user' }]);
      (context.metadata as any).customField = 'customValue';

      const result = await processor.process(context);

      expect(result.isAborted).toBe(context.isAborted);
      expect(result.metadata.model).toBe(context.metadata.model);
      expect(result.metadata.maxTokens).toBe(context.metadata.maxTokens);
      expect((result.metadata as any).customField).toBe('customValue');
    });
  });

  describe('abort', () => {
    it('should set isAborted to true', async () => {
      const processor = new AbortingProcessor();
      const context = createContext();

      const result = await processor.process(context);

      expect(result.isAborted).toBe(true);
    });

    it('should set abort reason', async () => {
      const processor = new AbortingProcessor();
      const context = createContext();

      const result = await processor.process(context);

      expect(result.abortReason).toBe('test abort reason');
    });

    it('should preserve other context properties', async () => {
      const processor = new AbortingProcessor();
      const context = createContext([{ content: 'test', role: 'user' }]);

      const result = await processor.process(context);

      expect(result.messages).toEqual(context.messages);
      expect(result.metadata).toEqual(context.metadata);
    });
  });

  describe('isEmptyMessage', () => {
    it('should return true for empty string', async () => {
      const processor = new MessageCheckingProcessor();
      const context = createContext([{ content: '', role: 'user' }]);

      await processor.process(context);

      expect(processor.lastEmptyCheck).toBe(true);
    });

    it('should return true for whitespace-only string', async () => {
      const processor = new MessageCheckingProcessor();
      const context = createContext([{ content: '   \n\t  ', role: 'user' }]);

      await processor.process(context);

      expect(processor.lastEmptyCheck).toBe(true);
    });

    it('should return true for null', async () => {
      const processor = new MessageCheckingProcessor();
      const context = createContext([{ content: null, role: 'user' }]);

      await processor.process(context);

      expect(processor.lastEmptyCheck).toBe(true);
    });

    it('should return true for undefined', async () => {
      const processor = new MessageCheckingProcessor();
      const context = createContext([{ content: undefined, role: 'user' }]);

      await processor.process(context);

      expect(processor.lastEmptyCheck).toBe(true);
    });

    it('should return false for non-empty string', async () => {
      const processor = new MessageCheckingProcessor();
      const context = createContext([{ content: 'hello', role: 'user' }]);

      await processor.process(context);

      expect(processor.lastEmptyCheck).toBe(false);
    });

    it('should return false for string with content after trim', async () => {
      const processor = new MessageCheckingProcessor();
      const context = createContext([{ content: '  hello  ', role: 'user' }]);

      await processor.process(context);

      expect(processor.lastEmptyCheck).toBe(false);
    });
  });

  describe('markAsExecuted', () => {
    it('should return context unchanged by default', async () => {
      const processor = new MessageCheckingProcessor();
      const context = createContext([{ content: 'test', role: 'user' }]);

      const result = await processor.process(context);

      // Since markAsExecuted is called in doProcess, verify context is returned
      expect(result.messages).toEqual(context.messages);
    });

    it('should be callable multiple times', async () => {
      class MultiMarkProcessor extends BaseProcessor {
        readonly name = 'MultiMarkProcessor';

        protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
          let result = this.cloneContext(context);
          result = this.markAsExecuted(result);
          result = this.markAsExecuted(result);
          return result;
        }
      }

      const processor = new MultiMarkProcessor();
      const context = createContext();

      const result = await processor.process(context);

      expect(result).toBeDefined();
      expect(result.messages).toEqual([]);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complex processing pipeline', async () => {
      class ComplexProcessor extends BaseProcessor {
        readonly name = 'ComplexProcessor';

        protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
          const cloned = this.cloneContext(context);

          // Check first message
          if (cloned.messages.length > 0) {
            const firstContent = cloned.messages[0].content;
            if (this.isEmptyMessage(typeof firstContent === 'string' ? firstContent : undefined)) {
              return this.abort(cloned, 'First message is empty');
            }
          }

          // Process messages
          cloned.messages = cloned.messages.map((msg) => ({
            ...msg,
            content: typeof msg.content === 'string' ? msg.content.toUpperCase() : msg.content,
          }));

          return this.markAsExecuted(cloned);
        }
      }

      const processor = new ComplexProcessor();
      const context = createContext([
        { content: 'hello', role: 'user' },
        { content: 'world', role: 'assistant' },
      ]);

      const result = await processor.process(context);

      expect(result.isAborted).toBe(false);
      expect(result.messages[0].content).toBe('HELLO');
      expect(result.messages[1].content).toBe('WORLD');
    });

    it('should abort when condition met', async () => {
      class ConditionalAbortProcessor extends BaseProcessor {
        readonly name = 'ConditionalAbortProcessor';

        protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
          const cloned = this.cloneContext(context);

          if (cloned.messages.length === 0) {
            return this.abort(cloned, 'No messages to process');
          }

          return cloned;
        }
      }

      const processor = new ConditionalAbortProcessor();
      const context = createContext([]);

      const result = await processor.process(context);

      expect(result.isAborted).toBe(true);
      expect(result.abortReason).toBe('No messages to process');
    });
  });
});
