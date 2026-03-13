/**
 * Document Templates
 *
 * Templates define sets of agent documents and their defaults.
 * "claw" is one template set.
 */

import type { DocumentTemplate } from '../template';
// Registry imports
import { CLAW_POLICY } from './claw';

export interface DocumentTemplateSet {
  description: string;
  id: string;
  name: string;
  /** Tags for categorization */
  tags?: string[];
  templates: DocumentTemplate[];
}

/**
 * Custom template set - empty template set for user-defined templates.
 */
export const CUSTOM_TEMPLATE_SET: DocumentTemplateSet = {
  id: 'custom',
  name: 'Custom',
  description: 'Build your own document template set from scratch',
  tags: ['custom', 'flexible'],
  templates: [],
};

// Import specific policy implementations
export * from './claw';

/**
 * Registry of all available document template sets.
 */
export const DOCUMENT_TEMPLATES: Record<string, DocumentTemplateSet> = {
  claw: CLAW_POLICY,
  custom: CUSTOM_TEMPLATE_SET,
};

/**
 * Get a document template set by ID.
 */
export function getDocumentTemplate(templateId: string): DocumentTemplateSet {
  return DOCUMENT_TEMPLATES[templateId] || CUSTOM_TEMPLATE_SET;
}

/**
 * Get all available document template sets.
 */
export function getAllDocumentTemplates(): DocumentTemplateSet[] {
  return Object.values(DOCUMENT_TEMPLATES);
}

/**
 * Get template sets by tags.
 */
export function getDocumentTemplatesByTags(tags: string[]): DocumentTemplateSet[] {
  return Object.values(DOCUMENT_TEMPLATES).filter((templateSet) =>
    templateSet.tags?.some((tag) => tags.includes(tag)),
  );
}

// Temporary aliases to reduce breakage while moving callers to template naming.
export type DocumentPolicy = DocumentTemplateSet;
export const CUSTOM_POLICY = CUSTOM_TEMPLATE_SET;
export const DOCUMENT_POLICIES = DOCUMENT_TEMPLATES;
export const getDocumentPolicy = getDocumentTemplate;
export const getAllDocumentPolicies = getAllDocumentTemplates;
export const getDocumentPoliciesByTags = getDocumentTemplatesByTags;
