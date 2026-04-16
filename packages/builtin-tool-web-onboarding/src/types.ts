import type { MarkdownPatchHunk } from '@lobechat/markdown-patch';

export const WebOnboardingIdentifier = 'lobe-web-onboarding';

export const WebOnboardingApiName = {
  finishOnboarding: 'finishOnboarding',
  getOnboardingState: 'getOnboardingState',
  patchDocument: 'patchDocument',
  readDocument: 'readDocument',
  saveUserQuestion: 'saveUserQuestion',
  updateDocument: 'updateDocument',
} as const;

export type WebOnboardingDocumentType = 'persona' | 'soul';

export interface PatchDocumentArgs {
  hunks: MarkdownPatchHunk[];
  type: WebOnboardingDocumentType;
}
