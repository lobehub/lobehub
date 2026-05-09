import { WebOnboardingApiName } from '../../types';
import UpdateDocument from './UpdateDocument';
import WriteDocument from './WriteDocument';

export const WebOnboardingRenders = {
  [WebOnboardingApiName.updateDocument]: UpdateDocument,
  [WebOnboardingApiName.writeDocument]: WriteDocument,
};

export { default as UpdateDocumentRender } from './UpdateDocument';
export { default as WriteDocumentRender } from './WriteDocument';
