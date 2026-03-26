// Re-export everything from @lobechat/agent-templates for backward compatibility
export {
  // Backward-compat aliases
  CUSTOM_POLICY,
  CUSTOM_TEMPLATE_SET,
  DOCUMENT_POLICIES,
  // Template registry
  DOCUMENT_TEMPLATES,
  type DocumentPolicy,
  // Template set types
  type DocumentTemplateSet,
  getAllDocumentPolicies,
  getAllDocumentTemplates,
  getDocumentPoliciesByTags,
  getDocumentPolicy,
  getDocumentTemplate,
  getDocumentTemplatesByTags,
} from '@lobechat/agent-templates';

// Re-export claw templates
export {
  AGENT_DOCUMENT,
  BOOTSTRAP_DOCUMENT,
  CLAW_POLICY,
  IDENTITY_DOCUMENT,
  SOUL_DOCUMENT,
} from '@lobechat/agent-templates';
