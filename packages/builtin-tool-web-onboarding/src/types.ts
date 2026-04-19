import type { MarkdownPatchHunk } from '@lobechat/markdown-patch';

export const WebOnboardingIdentifier = 'lobe-web-onboarding';

export const WebOnboardingApiName = {
  finishOnboarding: 'finishOnboarding',
  getOnboardingState: 'getOnboardingState',
  readDocument: 'readDocument',
  saveUserQuestion: 'saveUserQuestion',
  updateDocument: 'updateDocument',
  writeDocument: 'writeDocument',
} as const;

export type WebOnboardingDocumentType = 'persona' | 'soul';

export interface UpdateDocumentArgs {
  hunks: MarkdownPatchHunk[];
  type: WebOnboardingDocumentType;
}
