import type { PipelineContext } from '../types';
import { BaseProcessor } from './BaseProcessor';

/**
 * Minimal Provider: constrained to the single responsibility of "injecting system message at the beginning"
 */
export abstract class BaseProvider extends BaseProcessor {
  // Subclasses can optionally implement; by default no additional context is built

  protected async buildContext(_context: PipelineContext): Promise<string | null> {
    return null;
  }

  protected shouldInject(_context: PipelineContext): boolean {
    return true;
  }

  protected createSystemMessage(content: string): any {
    return { content, role: 'system' };
  }
}
