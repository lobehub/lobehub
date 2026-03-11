import { describe, expect, it, vi } from 'vitest';

import { ContextEngine } from '../pipeline';
import type { ContextProcessor } from '../types';
import { PipelineError } from '../types';

describe('ContextEngine', () => {
  const createMockProcessor = (name: string, delay = 0): ContextProcessor => ({
    name,
    process: vi.fn(async (context) => {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      return {
        ...context,
        metadata: {
          ...context.metadata,
          [name]: true,
        },
      };
    }),
  });

  const createAbortingProcessor = (name: string, reason = 'test abort'): ContextProcessor => ({
    name,
    process: vi.fn(async (context) => ({
      ...context,
      abortReason: reason,
      isAborted: true,
    })),
  });

  const createErrorProcessor = (name: string, error: Error): ContextProcessor => ({
    name,
    process: vi.fn(async () => {
      throw error;
    }),
  });

  const createInitialContext = (): {
    messages: any[];
  } => ({
    messages: [{ content: 'test', role: 'user' }],
  });

  describe('constructor', () => {
    it('should initialize with pipeline and options', () => {
      const processor1 = createMockProcessor('processor1');
      const processor2 = createMockProcessor('processor2');

      const engine = new ContextEngine({
        debug: true,
        pipeline: [processor1, processor2],
      });

      expect(engine.getProcessors()).toHaveLength(2);
      expect(engine.getProcessors()[0]).toBe(processor1);
      expect(engine.getProcessors()[1]).toBe(processor2);
    });

    it('should initialize with empty pipeline', () => {
      const engine = new ContextEngine({ pipeline: [] });
      expect(engine.getProcessors()).toHaveLength(0);
    });
  });

  describe('addProcessor', () => {
    it('should add processor to pipeline', () => {
      const engine = new ContextEngine({ pipeline: [] });
      const processor = createMockProcessor('test');

      engine.addProcessor(processor);

      expect(engine.getProcessors()).toHaveLength(1);
      expect(engine.getProcessors()[0]).toBe(processor);
    });

    it('should support chaining', () => {
      const engine = new ContextEngine({ pipeline: [] });
      const processor1 = createMockProcessor('p1');
      const processor2 = createMockProcessor('p2');

      const result = engine.addProcessor(processor1).addProcessor(processor2);

      expect(result).toBe(engine);
      expect(engine.getProcessors()).toHaveLength(2);
    });
  });

  describe('removeProcessor', () => {
    it('should remove processor by name', () => {
      const processor1 = createMockProcessor('p1');
      const processor2 = createMockProcessor('p2');
      const processor3 = createMockProcessor('p3');

      const engine = new ContextEngine({
        pipeline: [processor1, processor2, processor3],
      });

      engine.removeProcessor('p2');

      const processors = engine.getProcessors();
      expect(processors).toHaveLength(2);
      expect(processors[0].name).toBe('p1');
      expect(processors[1].name).toBe('p3');
    });

    it('should support chaining', () => {
      const processor1 = createMockProcessor('p1');
      const processor2 = createMockProcessor('p2');

      const engine = new ContextEngine({
        pipeline: [processor1, processor2],
      });

      const result = engine.removeProcessor('p1').removeProcessor('p2');

      expect(result).toBe(engine);
      expect(engine.getProcessors()).toHaveLength(0);
    });

    it('should do nothing if processor not found', () => {
      const processor = createMockProcessor('p1');
      const engine = new ContextEngine({ pipeline: [processor] });

      engine.removeProcessor('nonexistent');

      expect(engine.getProcessors()).toHaveLength(1);
    });
  });

  describe('getProcessors', () => {
    it('should return copy of processor list', () => {
      const processor = createMockProcessor('test');
      const engine = new ContextEngine({ pipeline: [processor] });

      const processors = engine.getProcessors();
      processors.push(createMockProcessor('new'));

      expect(engine.getProcessors()).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('should remove all processors', () => {
      const engine = new ContextEngine({
        pipeline: [createMockProcessor('p1'), createMockProcessor('p2')],
      });

      engine.clear();

      expect(engine.getProcessors()).toHaveLength(0);
    });

    it('should support chaining', () => {
      const engine = new ContextEngine({
        pipeline: [createMockProcessor('p1')],
      });

      const result = engine.clear();

      expect(result).toBe(engine);
    });
  });

  describe('process', () => {
    it('should execute processors in sequence', async () => {
      const processor1 = createMockProcessor('p1');
      const processor2 = createMockProcessor('p2');
      const processor3 = createMockProcessor('p3');

      const engine = new ContextEngine({
        pipeline: [processor1, processor2, processor3],
      });

      const input = createInitialContext();
      const result = await engine.process(input);

      expect(result.isAborted).toBe(false);
      expect(result.messages).toEqual(input.messages);
      expect(result.metadata.p1).toBe(true);
      expect(result.metadata.p2).toBe(true);
      expect(result.metadata.p3).toBe(true);
      expect(result.stats.processedCount).toBe(3);
    });

    it('should handle messages array correctly', async () => {
      const processor = createMockProcessor('p1');
      const engine = new ContextEngine({ pipeline: [processor] });

      const input = createInitialContext();
      const result = await engine.process(input);

      expect(result.messages).toEqual(input.messages);
    });

    it('should handle empty messages', async () => {
      const processor = createMockProcessor('p1');
      const engine = new ContextEngine({ pipeline: [processor] });

      const result = await engine.process({ messages: [] });

      expect(result.messages).toEqual([]);
    });

    it('should include metadata in context', async () => {
      const processor: ContextProcessor = {
        name: 'test',
        process: vi.fn(async (context) => {
          expect(context.metadata).toBeDefined();
          return context;
        }),
      };

      const engine = new ContextEngine({ pipeline: [processor] });

      await engine.process(createInitialContext());
    });

    it('should track execution stats', async () => {
      const processor1 = createMockProcessor('p1', 10);
      const processor2 = createMockProcessor('p2', 20);

      const engine = new ContextEngine({
        pipeline: [processor1, processor2],
      });

      const result = await engine.process(createInitialContext());

      expect(result.stats.processedCount).toBe(2);
      expect(result.stats.totalDuration).toBeGreaterThanOrEqual(20);
    });

    it('should stop processing when aborted', async () => {
      const processor1 = createMockProcessor('p1');
      const processor2 = createAbortingProcessor('p2', 'user requested');
      const processor3 = createMockProcessor('p3');

      const engine = new ContextEngine({
        pipeline: [processor1, processor2, processor3],
      });

      const result = await engine.process(createInitialContext());

      expect(result.isAborted).toBe(true);
      expect(result.abortReason).toBe('user requested');
      expect(result.stats.processedCount).toBe(2);
      expect(processor1.process).toHaveBeenCalled();
      expect(processor2.process).toHaveBeenCalled();
      expect(processor3.process).not.toHaveBeenCalled();
    });

    it('should skip remaining processors if context is already aborted', async () => {
      const processor1: ContextProcessor = {
        name: 'p1',
        process: vi.fn(async (context) => ({
          ...context,
          isAborted: true,
        })),
      };
      const processor2 = createMockProcessor('p2');

      const engine = new ContextEngine({
        pipeline: [processor1, processor2],
      });

      const result = await engine.process(createInitialContext());

      expect(result.isAborted).toBe(true);
      expect(result.stats.processedCount).toBe(1);
      expect(processor2.process).not.toHaveBeenCalled();
    });

    it('should throw PipelineError when processor fails', async () => {
      const error = new Error('processor failed');
      const processor = createErrorProcessor('failing-processor', error);

      const engine = new ContextEngine({ pipeline: [processor] });

      await expect(engine.process(createInitialContext())).rejects.toThrow(PipelineError);
      await expect(engine.process(createInitialContext())).rejects.toThrow(
        'Processor [failing-processor] execution failed',
      );
    });

    it('should include processor stats even when it fails', async () => {
      const error = new Error('test error');
      const processor = createErrorProcessor('failing', error);

      const engine = new ContextEngine({ pipeline: [processor] });

      try {
        await engine.process(createInitialContext());
      } catch (e) {
        expect(e).toBeInstanceOf(PipelineError);
        if (e instanceof PipelineError) {
          expect(e.processorName).toBe('failing');
          expect(e.originalError).toBe(error);
        }
      }
    });

    it('should handle non-Error objects thrown by processor', async () => {
      const processor: ContextProcessor = {
        name: 'thrower',
        process: vi.fn(async () => {
          throw 'string error';
        }),
      };

      const engine = new ContextEngine({ pipeline: [processor] });

      await expect(engine.process(createInitialContext())).rejects.toThrow(PipelineError);
    });

    it('should preserve initial state', async () => {
      const testContext = createInitialContext();
      const processor: ContextProcessor = {
        name: 'test',
        process: vi.fn(async (context) => {
          expect(context.initialState.messages).toEqual(testContext.messages);
          return context;
        }),
      };

      const engine = new ContextEngine({ pipeline: [processor] });
      await engine.process(testContext);
    });
  });

  describe('getStats', () => {
    it('should return processor count and names', () => {
      const processor1 = createMockProcessor('p1');
      const processor2 = createMockProcessor('p2');

      const engine = new ContextEngine({
        pipeline: [processor1, processor2],
      });

      const stats = engine.getStats();

      expect(stats.processorCount).toBe(2);
      expect(stats.processorNames).toEqual(['p1', 'p2']);
    });

    it('should return empty stats for empty pipeline', () => {
      const engine = new ContextEngine({ pipeline: [] });

      const stats = engine.getStats();

      expect(stats.processorCount).toBe(0);
      expect(stats.processorNames).toEqual([]);
    });
  });

  describe('clone', () => {
    it('should create independent copy of engine', () => {
      const processor1 = createMockProcessor('p1');
      const processor2 = createMockProcessor('p2');

      const engine1 = new ContextEngine({
        debug: true,
        pipeline: [processor1, processor2],
      });

      const engine2 = engine1.clone();

      expect(engine2).not.toBe(engine1);
      expect(engine2.getProcessors()).toHaveLength(2);
      expect(engine2.getProcessors()[0]).toBe(processor1);
      expect(engine2.getProcessors()[1]).toBe(processor2);

      // Modify cloned engine
      engine2.addProcessor(createMockProcessor('p3'));

      // Original should be unchanged
      expect(engine1.getProcessors()).toHaveLength(2);
      expect(engine2.getProcessors()).toHaveLength(3);
    });
  });

  describe('validate', () => {
    it('should return valid for correct pipeline', () => {
      const processor1 = createMockProcessor('p1');
      const processor2 = createMockProcessor('p2');

      const engine = new ContextEngine({
        pipeline: [processor1, processor2],
      });

      const result = engine.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect duplicate processor names', () => {
      const processor1 = createMockProcessor('duplicate');
      const processor2 = createMockProcessor('duplicate');

      const engine = new ContextEngine({
        pipeline: [processor1, processor2],
      });

      const result = engine.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Found duplicate processor names: duplicate');
    });

    it('should detect empty pipeline', () => {
      const engine = new ContextEngine({ pipeline: [] });

      const result = engine.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No processors in pipeline');
    });

    it('should detect missing processor name', () => {
      const processor: ContextProcessor = {
        name: '',
        process: vi.fn(),
      };

      const engine = new ContextEngine({ pipeline: [processor] });

      const result = engine.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Processor missing name');
    });

    it('should detect missing process method', () => {
      const processor = {
        name: 'test',
      } as any;

      const engine = new ContextEngine({ pipeline: [processor] });

      const result = engine.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Processor [test] missing process method');
    });

    it('should detect multiple errors', () => {
      const processor1 = createMockProcessor('duplicate');
      const processor2 = createMockProcessor('duplicate');
      const processor3: ContextProcessor = {
        name: '',
        process: vi.fn(),
      };

      const engine = new ContextEngine({
        pipeline: [processor1, processor2, processor3],
      });

      const result = engine.validate();

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });
});
