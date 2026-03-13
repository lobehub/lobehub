/**
 * Claw Policy
 *
 * Sharp, evolving agent with retractable claws that grip onto identity and purpose.
 * Similar to OpenClaw but with structured document loading.
 */

import type { DocumentTemplateSet } from '../index';
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
  templates: [SOUL_DOCUMENT, IDENTITY_DOCUMENT],
};

// Re-export individual templates for external use
export { IDENTITY_DOCUMENT, SOUL_DOCUMENT };
