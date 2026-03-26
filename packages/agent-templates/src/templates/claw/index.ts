import type { DocumentTemplateSet } from '../index';
import { AGENT_DOCUMENT } from './agent';
import { BOOTSTRAP_DOCUMENT } from './bootstrap';
import { IDENTITY_DOCUMENT } from './identity';
import { SOUL_DOCUMENT } from './soul';

/**
 * Claw Policy Definition
 */
export const CLAW_POLICY: DocumentTemplateSet = {
  id: 'claw',
  name: 'Claw',
  description: 'Sharp, evolving agent with retractable claws that grip onto identity and purpose',
  tags: ['personality', 'evolving', 'autonomous'],
  templates: [AGENT_DOCUMENT, BOOTSTRAP_DOCUMENT, IDENTITY_DOCUMENT, SOUL_DOCUMENT],
};

// Re-export individual templates for external use
export { AGENT_DOCUMENT, BOOTSTRAP_DOCUMENT, IDENTITY_DOCUMENT, SOUL_DOCUMENT };
