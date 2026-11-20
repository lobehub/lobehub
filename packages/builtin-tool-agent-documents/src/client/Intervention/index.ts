import { AgentDocumentsApiName } from '../../types';
import CreateFolder from './CreateFolder';
import MoveDocuments from './MoveDocuments';

/** Approval cards for the APIs whose raw arguments are ids the user cannot read. */
export const AgentDocumentsInterventions = {
  [AgentDocumentsApiName.createFolder]: CreateFolder,
  [AgentDocumentsApiName.moveDocuments]: MoveDocuments,
};
