import type { DocumentTemplate } from '../../template';
import { DocumentLoadFormat, DocumentLoadPosition, PolicyLoad } from '../../types';
import content from './SOUL.md';

/**
 * Soul Document
 *
 * Core truths and behavioral guidelines that define the foundational nature
 * of a Claw agent. Always loaded to maintain consistent behavior.
 */
export const SOUL_DOCUMENT: DocumentTemplate = {
  title: 'Soul',
  filename: 'SOUL.md',
  description: 'Core truths, boundaries, vibe, and continuity',
  policyLoad: PolicyLoad.ALWAYS,
  policyLoadFormat: DocumentLoadFormat.FILE,
  loadPosition: DocumentLoadPosition.SYSTEM_APPEND,
  loadRules: {
    priority: 3,
  },
  content,
};
