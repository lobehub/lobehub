import type { DocumentTemplate } from '../../template';
import { DocumentLoadFormat, DocumentLoadPosition } from '../../types';
import content from './AGENTS.md';

/**
 * Workspace Document
 *
 * Workspace-specific operating instructions and memory workflow.
 */
export const AGENT_DOCUMENT: DocumentTemplate = {
  title: 'Workspace',
  filename: 'AGENTS.md',
  description: 'How to use agent documents as durable state, working memory, and operating rules',
  policyLoadFormat: DocumentLoadFormat.FILE,
  loadPosition: DocumentLoadPosition.BEFORE_SYSTEM,
  loadRules: {
    priority: 0,
  },
  content,
};
