/**
 * Claw Policy
 *
 * Sharp, evolving agent with retractable claws that grip onto identity and purpose.
 * Similar to OpenClaw but with structured document loading.
 */

import type { DocumentTemplateSet } from '../index';
import { AGENT_DOCUMENT } from './agent';
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
  templates: [SOUL_DOCUMENT, IDENTITY_DOCUMENT, AGENT_DOCUMENT],
};

// Re-export individual templates for external use
export { AGENT_DOCUMENT, IDENTITY_DOCUMENT, SOUL_DOCUMENT };
