import {
  applyMarkdownPatch,
  formatMarkdownPatchError,
  type MarkdownPatchHunk,
} from '@lobechat/markdown-patch';
import type { BuiltinServerRuntimeOutput, SaveUserQuestionInput } from '@lobechat/types';

import {
  createDocumentReadResult,
  createWebOnboardingToolResult,
  formatWebOnboardingStateMessage,
} from './utils';

export interface WebOnboardingRuntimeService {
  finishOnboarding: () => Promise<{
    content: string;
    finishedAt?: string;
    success: boolean;
  }>;
  getOnboardingState: () => Promise<{
    finished: boolean;
    missingStructuredFields: string[];
    phase: string;
    remainingDiscoveryExchanges?: number;
  }>;
  readDocument: (type: 'soul' | 'persona') => Promise<{
    content: string | null;
    id: string | null;
  }>;
  saveUserQuestion: (input: SaveUserQuestionInput) => Promise<{
    content: string;
    ignoredFields?: string[];
    savedFields?: string[];
    success: boolean;
    unchangedFields?: string[];
  }>;
  updateDocument: (
    type: 'soul' | 'persona',
    content: string,
  ) => Promise<{
    id: string | null;
  }>;
}

export class WebOnboardingExecutionRuntime {
  constructor(private service: WebOnboardingRuntimeService) {}

  async getOnboardingState(): Promise<BuiltinServerRuntimeOutput> {
    const result = await this.service.getOnboardingState();

    return {
      content: formatWebOnboardingStateMessage(result),
      state: result,
      success: true,
    };
  }

  async saveUserQuestion(params: SaveUserQuestionInput): Promise<BuiltinServerRuntimeOutput> {
    const result = await this.service.saveUserQuestion(params);

    return createWebOnboardingToolResult(result);
  }

  async finishOnboarding(): Promise<BuiltinServerRuntimeOutput> {
    const result = await this.service.finishOnboarding();

    return createWebOnboardingToolResult(result);
  }

  async readDocument(params: { type: 'soul' | 'persona' }): Promise<BuiltinServerRuntimeOutput> {
    const result = await this.service.readDocument(params.type);

    return createDocumentReadResult(params.type, result.content, result.id);
  }

  async writeDocument(params: {
    content: string;
    type: 'soul' | 'persona';
  }): Promise<BuiltinServerRuntimeOutput> {
    const result = await this.service.updateDocument(params.type, params.content);

    if (!result.id) {
      return { content: `Failed to write ${params.type} document.`, success: false };
    }

    return {
      content: `Wrote ${params.type} document (${result.id}).`,
      state: { id: result.id, type: params.type },
      success: true,
    };
  }

  async updateDocument(params: {
    hunks: MarkdownPatchHunk[];
    type: 'soul' | 'persona';
  }): Promise<BuiltinServerRuntimeOutput> {
    const current = await this.service.readDocument(params.type);
    const patched = applyMarkdownPatch(current.content ?? '', params.hunks);

    if (!patched.ok) {
      return {
        content: formatMarkdownPatchError(patched.error),
        error: {
          body: patched.error,
          message: formatMarkdownPatchError(patched.error),
          type: patched.error.code,
        },
        state: { error: patched.error, type: params.type },
        success: false,
      };
    }

    const updated = await this.service.updateDocument(params.type, patched.content);
    if (!updated.id) {
      return { content: `Failed to update ${params.type} document.`, success: false };
    }

    return {
      content: `Updated ${params.type} document (${updated.id}). Applied ${patched.applied} hunk(s).`,
      state: { applied: patched.applied, id: updated.id, type: params.type },
      success: true,
    };
  }
}
