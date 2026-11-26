import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type { ReadCardDocsParams, RenderUIParams } from '../types';

/** The processor (schemas, examples, validator) loads on first use, so the tool registry stays light. */
const processor = async () => (await import('@lobehub/a2ui/processor')).getA2uiProcessor();

/**
 * Validates and stores a card, and reads component docs, through the `@lobehub/a2ui` processor.
 * Runs wherever the tool runs; nothing here renders. The state carries the surface for the Render
 * and for a Channel reply; the content tells the model what it drew, or what to fix.
 */
export class A2uiExecutionRuntime {
  async renderUI(params: RenderUIParams): Promise<BuiltinServerRuntimeOutput> {
    return (await processor()).execute(params) as BuiltinServerRuntimeOutput;
  }

  async readCardDocs(params: ReadCardDocsParams): Promise<BuiltinServerRuntimeOutput> {
    return { content: (await processor()).docs(params), success: true };
  }
}
