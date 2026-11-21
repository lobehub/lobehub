import { BrowserApiName } from '../../types';
import UploadFile from './UploadFile';

/** Approval cards, for the APIs whose manifest entry sets `humanIntervention`. */
export const BrowserInterventions = {
  [BrowserApiName.uploadFile]: UploadFile,
};
