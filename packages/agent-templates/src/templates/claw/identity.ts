import type { DocumentTemplate } from '../../template';
import { DocumentLoadFormat, DocumentLoadPosition, PolicyLoad } from '../../types';
import content from './IDENTITY.md';

/**
 * Identity Document
 *
 * Self-definition and characteristics that shape the agent's personality.
 */
export const IDENTITY_DOCUMENT: DocumentTemplate = {
  title: 'Identity',
  filename: 'IDENTITY.md',
  description: 'Name, creature type, vibe, and avatar identity',
  policyLoad: PolicyLoad.ALWAYS,
  policyLoadFormat: DocumentLoadFormat.FILE,
  loadPosition: DocumentLoadPosition.SYSTEM_APPEND,
  loadRules: {
    priority: 2,
  },
  content,
};
