import type { DocumentTemplate } from '../../template';
import { DocumentLoadFormat, DocumentLoadPosition, PolicyLoad } from '../../types';
import content from './BOOTSTRAP.md';

/**
 * Bootstrap Document
 *
 * First-run onboarding guide that walks the agent through identity setup.
 * Loaded before identity/soul so it takes priority on fresh agents.
 * The agent should delete this document after onboarding is complete.
 */
export const BOOTSTRAP_DOCUMENT: DocumentTemplate = {
  title: 'Bootstrap',
  filename: 'BOOTSTRAP.md',
  description: 'First-run onboarding: discover identity, set up user profile, then self-destruct',
  policyLoad: PolicyLoad.ALWAYS,
  policyLoadFormat: DocumentLoadFormat.FILE,
  loadPosition: DocumentLoadPosition.SYSTEM_APPEND,
  loadRules: {
    priority: 1,
  },
  content,
};
