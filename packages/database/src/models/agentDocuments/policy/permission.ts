import type { AgentDocument } from '../types';
import { AgentAccess, PolicyLoad } from '../types';

export const hasAgentAccess = (access: number, required: AgentAccess): boolean => {
  return (access & required) === required;
};

export const canListDocument = (doc: Pick<AgentDocument, 'accessSelf'>): boolean => {
  return hasAgentAccess(doc.accessSelf, AgentAccess.LIST);
};

export const canReadDocument = (doc: Pick<AgentDocument, 'accessSelf'>): boolean => {
  return hasAgentAccess(doc.accessSelf, AgentAccess.READ);
};

export const canWriteDocument = (doc: Pick<AgentDocument, 'accessSelf'>): boolean => {
  return hasAgentAccess(doc.accessSelf, AgentAccess.WRITE);
};

export const canDeleteDocument = (doc: Pick<AgentDocument, 'accessSelf'>): boolean => {
  return hasAgentAccess(doc.accessSelf, AgentAccess.DELETE);
};

export const canAutoLoadDocument = (doc: Pick<AgentDocument, 'policyLoad'>): boolean => {
  return doc.policyLoad === PolicyLoad.ALWAYS;
};

export const isLoadableDocument = (
  doc: Pick<AgentDocument, 'accessSelf' | 'policyLoad'>,
): boolean => {
  return canAutoLoadDocument(doc) && canListDocument(doc) && canReadDocument(doc);
};
