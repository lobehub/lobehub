import { DOCUMENT_FOLDER_TYPE } from '@lobechat/database/schemas';

import type { AgentDocument, ToolUpdateLoadRule } from '@/database/models/agentDocuments';

import { AgentDocumentVfsError } from '../agentDocumentVfs/errors';
import { isManagedSkillDocument } from '../agentDocumentVfs/mounts/skills/providers/providerSkillsAgentDocumentUtils';

/**
 * Refuses load-mode changes the context pipeline must not or cannot honor.
 *
 * Use when:
 * - A tool-driven load-rule update carries `mode`, before it is written
 *
 * Expects:
 * - `doc` is the stored binding the update targets
 *
 * Returns:
 * - Nothing; throws `METHOD_NOT_SUPPORTED` for skill documents (kept out of
 *   context on purpose and surfaced through the skills system instead) and for
 *   folders (no body, dropped from context, so "always" would load nothing)
 */
export const assertLoadModeChangeAllowed = (
  doc: Pick<AgentDocument, 'fileType' | 'templateId'>,
  rule: Pick<ToolUpdateLoadRule, 'mode'>,
): void => {
  if (!rule.mode) return;

  if (isManagedSkillDocument(doc) || doc.fileType.startsWith('skills/')) {
    throw new AgentDocumentVfsError(
      'Skill documents are loaded through the skills system; their load mode cannot be changed.',
      'METHOD_NOT_SUPPORTED',
    );
  }

  if (doc.fileType === DOCUMENT_FOLDER_TYPE) {
    throw new AgentDocumentVfsError(
      'Folders have no content to load; set the load mode on the documents inside the folder instead.',
      'METHOD_NOT_SUPPORTED',
    );
  }
};
