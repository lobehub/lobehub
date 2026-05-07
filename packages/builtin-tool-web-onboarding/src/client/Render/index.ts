import { WebOnboardingApiName } from '../../types';
import WriteDocument from './WriteDocument';

export const WebOnboardingRenders = {
  [WebOnboardingApiName.writeDocument]: WriteDocument,
};

export { default as WriteDocumentRender } from './WriteDocument';
