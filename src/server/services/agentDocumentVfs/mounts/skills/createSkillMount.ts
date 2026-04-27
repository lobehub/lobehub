import type { LobeChatDatabase } from '@lobechat/database';

import { AgentModel } from '@/database/models/agent';
import { AgentDocumentModel } from '@/database/models/agentDocuments';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { DocumentService } from '@/server/services/document';
import { SkillResourceService } from '@/server/services/skill/resource';

import { ProviderSkillsAgentDocument } from './providers/ProviderSkillsAgentDocument';
import { ProviderSkillsBuiltin } from './providers/ProviderSkillsBuiltin';
import { ProviderSkillsInstalledActive } from './providers/ProviderSkillsInstalledActive';
import { ProviderSkillsInstalledAll } from './providers/ProviderSkillsInstalledAll';
import { SkillMount } from './SkillMount';

/**
 * Creates the skill mount with all VFS namespace providers registered.
 *
 * Use when:
 * - Building request-scoped VFS services for skill mount operations.
 * - Wiring writable document-backed skills and read-only installed/builtin skills.
 *
 * Expects:
 * - `db` and `userId` belong to the current request scope.
 *
 * Returns:
 * - A skill mount that routes unified skill paths to namespace-specific providers.
 */
export const createSkillMount = (db: LobeChatDatabase, userId: string) => {
  const agentModel = new AgentModel(db, userId);
  const agentDocumentModel = new AgentDocumentModel(db, userId);
  const documentService = new DocumentService(db, userId);
  const skillModel = new AgentSkillModel(db, userId);
  const skillResourceService = new SkillResourceService(db, userId);
  return new SkillMount({
    'agent': new ProviderSkillsAgentDocument('agent', {
      agentDocumentModel,
      documentService,
    }),
    'agent-topic': new ProviderSkillsAgentDocument('agent-topic', {
      agentDocumentModel,
      documentService,
    }),
    'builtin': new ProviderSkillsBuiltin(),
    'installed-active': new ProviderSkillsInstalledActive({
      agentModel,
      skillModel,
      skillResourceService,
    }),
    'installed-all': new ProviderSkillsInstalledAll({
      skillModel,
      skillResourceService,
    }),
  });
};
