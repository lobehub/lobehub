import type { DocumentLoadFormat, DocumentLoadRule } from '@lobechat/agent-templates';
import { AgentDocumentsExecutionRuntime } from '@lobechat/builtin-tool-agent-documents/executionRuntime';
import { AgentDocumentsExecutor } from '@lobechat/builtin-tool-agent-documents/executor';

import { agentDocumentService } from '@/services/agentDocument';

const runtime = new AgentDocumentsExecutionRuntime({
  copyDocument: ({ agentId, id, newTitle }) =>
    agentDocumentService.copyDocument({ agentId, id, newTitle }),
  createDocument: ({ agentId, content, title }) =>
    agentDocumentService.createDocument({ agentId, content, title }),
  editDocument: ({ agentId, content, id }) =>
    agentDocumentService.editDocument({ agentId, content, id }),
  readDocument: ({ agentId, id }) => agentDocumentService.readDocument({ agentId, id }),
  removeDocument: async ({ agentId, id }) =>
    (await agentDocumentService.removeDocument({ agentId, id })).deleted,
  renameDocument: ({ agentId, id, newTitle }) =>
    agentDocumentService.renameDocument({ agentId, id, newTitle }),
  updateLoadRule: ({ agentId, id, rule }) =>
    agentDocumentService.updateLoadRule({
      agentId,
      id,
      rule: {
        ...rule,
        policyLoadFormat: rule.policyLoadFormat as DocumentLoadFormat | undefined,
        rule: rule.rule as DocumentLoadRule | undefined,
      },
    }),
});

export const agentDocumentsExecutor = new AgentDocumentsExecutor(runtime);
