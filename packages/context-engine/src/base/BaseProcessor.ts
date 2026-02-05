import type { ContextProcessor, PipelineContext, ProcessorOptions } from '../types';
import { ProcessorError } from '../types';

/**
 * Base processor abstract class
 * Provides common processor functionality and error handling
 */
export abstract class BaseProcessor implements ContextProcessor {
  abstract readonly name: string;

  // Keep parameters for compatibility with existing subclass constructor signatures, but do no processing

  constructor(_options: ProcessorOptions = {}) {}

  /**
   * Core processing method - subclasses need to implement
   */
  protected abstract doProcess(context: PipelineContext): Promise<PipelineContext>;

  /**
   * Public processing entry point, includes error handling and logging
   */
  async process(context: PipelineContext): Promise<PipelineContext> {
    try {
      this.validateInput(context);
      const result = await this.doProcess(context);
      this.validateOutput(result);
      return result;
    } catch (error) {
      throw new ProcessorError(
        this.name,
        `Processing failed: ${error}`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Validate input context
   */
  protected validateInput(context: PipelineContext): void {
    if (!context || !Array.isArray(context.messages)) {
      throw new Error('Invalid context');
    }
  }

  /**
   * Validate output context
   */
  protected validateOutput(context: PipelineContext): void {
    if (!context || !Array.isArray(context.messages)) {
      throw new Error('Invalid output context');
    }
  }

  /**
   * Safely clone context
   */
  protected cloneContext(context: PipelineContext): PipelineContext {
    return {
      ...context,
      messages: [...context.messages],
      metadata: { ...context.metadata },
    };
  }

  /**
   * Abort pipeline processing
   */
  protected abort(context: PipelineContext, reason: string): PipelineContext {
    return {
      ...context,
      abortReason: reason,
      isAborted: true,
    };
  }

  /**
   * Check if message is empty
   */
  protected isEmptyMessage(message: string | undefined | null): boolean {
    return !message || message.trim().length === 0;
  }

  protected markAsExecuted(context: PipelineContext): PipelineContext {
    return context;
  }
}
