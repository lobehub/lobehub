import { WebOnboardingApiName } from '../../types';
import SaveUserQuestion from './SaveUserQuestion';
import UpdateDocument from './UpdateDocument';
import WriteDocument from './WriteDocument';

export const WebOnboardingRenders = {
  [WebOnboardingApiName.saveUserQuestion]: SaveUserQuestion,
  [WebOnboardingApiName.updateDocument]: UpdateDocument,
  [WebOnboardingApiName.writeDocument]: WriteDocument,
};

export { default as SaveUserQuestionRender } from './SaveUserQuestion';
export { default as UpdateDocumentRender } from './UpdateDocument';
export { default as WriteDocumentRender } from './WriteDocument';
