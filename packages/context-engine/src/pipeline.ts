import debug from 'debug';

import type { ContextProcessor, PipelineContext, PipelineResult, ProcessorOptions } from './types';
import { PipelineError } from './types';

const log = debug('context-engine:ContextEngine');

/**
 * Context Engine Configuration
 */
export interface ContextEngineConfig extends ProcessorOptions {
  /** Processor pipeline */
  pipeline: ContextProcessor[];
}

/**
 * Context Engine - Core orchestrator that executes processors sequentially
 */
export class ContextEngine {
  private processors: ContextProcessor[] = [];
  private options: ProcessorOptions;

  constructor(config: ContextEngineConfig) {
    const { pipeline, ...options } = config;
    this.processors = [...pipeline];
    this.options = {
      debug: false,
      logger: console.log,
      ...options,
    };
  }

  /**
   * Add processor to pipeline
   */
  addProcessor(processor: ContextProcessor): this {
    this.processors.push(processor);
    return this;
  }

  /**
   * Remove processor
   */
  removeProcessor(name: string): this {
    this.processors = this.processors.filter((p) => p.name !== name);
    return this;
  }

  /**
   * Get processor list
   */
  getProcessors(): ContextProcessor[] {
    return [...this.processors];
  }

  /**
   * Clear all processors
   */
  clear(): this {
    this.processors = [];
    return this;
  }

  /**
   * Execute pipeline processing
   */
  async process(input: { messages: Array<any> }): Promise<PipelineResult> {
    const startTime = Date.now();
    const processorDurations: Record<string, number> = {};

    // Create initial pipeline context
    let context: PipelineContext = {
      initialState: { messages: input.messages },
      isAborted: false,
      messages: [...input.messages],
      metadata: {},
    };

    log('Starting pipeline processing');
    log('Number of processors:', this.processors.length);

    let processedCount = 0;

    try {
      // Execute each processor in sequence
      for (const processor of this.processors) {
        if (context.isAborted) {
          log('Pipeline aborted before processor', processor.name, 'reason:', context.abortReason);
          break;
        }

        const processorStartTime = Date.now();
        log('Executing processor:', processor.name);

        try {
          context = await processor.process(context);
          processedCount++;

          const duration = Date.now() - processorStartTime;
          processorDurations[processor.name] = duration;

          log('Processor', processor.name, 'completed in', duration + 'ms');

          if (context.isAborted) {
            log('Pipeline aborted by processor', processor.name, 'reason:', context.abortReason);
            break;
          }
        } catch (error) {
          const duration = Date.now() - processorStartTime;
          processorDurations[processor.name] = duration;

          log('Processor', processor.name, 'execution failed:', error);
          throw new PipelineError(
            `Processor [${processor.name}] execution failed`,
            processor.name,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }

      const totalDuration = Date.now() - startTime;
      log('Pipeline processing completed in', totalDuration + 'ms');

      return {
        abortReason: context.abortReason,
        isAborted: context.isAborted,
        messages: context.messages,
        metadata: context.metadata,
        stats: {
          processedCount,
          processorDurations,
          totalDuration,
        },
      };
    } catch (error) {
      log('Pipeline processing failed:', error);

      if (error instanceof PipelineError) {
        throw error;
      }

      throw new PipelineError(
        'Unknown error occurred during pipeline processing',
        undefined,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Get pipeline statistics
   */
  getStats() {
    return {
      processorCount: this.processors.length,
      processorNames: this.processors.map((p) => p.name),
    };
  }

  /**
   * Clone pipeline (deep copy processor list)
   */
  clone(): ContextEngine {
    return new ContextEngine({
      pipeline: [...this.processors],
      ...this.options,
    });
  }

  /**
   * Validate pipeline configuration
   */
  validate(): { errors: string[]; valid: boolean } {
    const errors: string[] = [];

    // Check for duplicate processor names
    const names = this.processors.map((p) => p.name);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    if (duplicates.length > 0) {
      errors.push(`Found duplicate processor names: ${duplicates.join(', ')}`);
    }

    // Check if processors are empty
    if (this.processors.length === 0) {
      errors.push('No processors in pipeline');
    }

    // Check if processors implement required methods
    this.processors.forEach((processor) => {
      if (!processor.name) {
        errors.push('Processor missing name');
      }
      if (typeof processor.process !== 'function') {
        errors.push(`Processor [${processor.name}] missing process method`);
      }
    });

    return {
      errors,
      valid: errors.length === 0,
    };
  }
}
