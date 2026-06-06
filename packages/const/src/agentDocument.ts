export const AGENT_DOCUMENT_CATEGORY = 'document';
export const AGENT_DOCUMENT_SKILL_CATEGORY = 'skill';
export const AGENT_DOCUMENT_WEB_CATEGORY = 'web';

export const AGENT_DOCUMENT_SOURCE_TYPE = 'agent';
export const AGENT_SIGNAL_SOURCE_TYPE = 'agent-signal';
export const DERIVED_DOCUMENT_SOURCE_TYPE = 'document';
export const WEB_DOCUMENT_SOURCE_TYPE = 'web';

export const AGENT_DOCUMENT_FILE_TYPE = 'agent/document';
export const AGENT_PLAN_FILE_TYPE = 'agent/plan';
export const CUSTOM_DOCUMENT_FILE_TYPE = 'custom/document';
export const CUSTOM_FOLDER_FILE_TYPE = 'custom/folder';

export const MARKDOWN_MIME_TYPES = ['text/markdown', 'text/x-markdown'];

export const MARKDOWN_DOCUMENT_FILE_TYPES = ['markdown', ...MARKDOWN_MIME_TYPES];

export const EDITOR_DOCUMENT_SOURCE_TYPES = [
  AGENT_DOCUMENT_SOURCE_TYPE,
  AGENT_SIGNAL_SOURCE_TYPE,
  DERIVED_DOCUMENT_SOURCE_TYPE,
];

export const hasFilenameExtension = (filename: string): boolean =>
  /(?:^|[^.])\.[^.]+$/.test(filename);
