import type { BuiltinInspector } from '@lobechat/types';

import { WebOnboardingApiName } from '../../types';
import { FinishOnboardingInspector } from './FinishOnboarding';
import { ReadDocumentInspector } from './ReadDocument';
import { SaveUserQuestionInspector } from './SaveUserQuestion';
import { UpdateDocumentInspector } from './UpdateDocument';
import { WriteDocumentInspector } from './WriteDocument';

export const WebOnboardingInspectors: Record<string, BuiltinInspector> = {
  [WebOnboardingApiName.finishOnboarding]: FinishOnboardingInspector as BuiltinInspector,
  [WebOnboardingApiName.readDocument]: ReadDocumentInspector as BuiltinInspector,
  [WebOnboardingApiName.saveUserQuestion]: SaveUserQuestionInspector as BuiltinInspector,
  [WebOnboardingApiName.updateDocument]: UpdateDocumentInspector as BuiltinInspector,
  [WebOnboardingApiName.writeDocument]: WriteDocumentInspector as BuiltinInspector,
};

export { default as FinishOnboardingInspector } from './FinishOnboarding';
export { default as ReadDocumentInspector } from './ReadDocument';
export { default as SaveUserQuestionInspector } from './SaveUserQuestion';
export { default as UpdateDocumentInspector } from './UpdateDocument';
export { default as WriteDocumentInspector } from './WriteDocument';
