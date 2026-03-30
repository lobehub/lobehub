import type { DocumentLoadFormat, DocumentLoadRule } from '@lobechat/agent-templates';

import { lambdaClient } from '@/libs/trpc/client';

class AgentDocumentService {
  getTemplates = async () => {
    return lambdaClient.agentDocument.getTemplates.query();
  };

  getDocuments = async (params: { agentId: string }) => {
    return lambdaClient.agentDocument.getDocuments.query(params);
  };

  initializeFromTemplate = async (params: { agentId: string; templateSet: string }) => {
    return lambdaClient.agentDocument.initializeFromTemplate.mutate(params);
  };

  createDocument = async (params: { agentId: string; content: string; title: string }) => {
    return lambdaClient.agentDocument.createDocument.mutate(params);
  };

  readDocument = async (params: { agentId: string; id: string }) => {
    return lambdaClient.agentDocument.readDocument.query(params);
  };

  editDocument = async (params: { agentId: string; content: string; id: string }) => {
    return lambdaClient.agentDocument.editDocument.mutate(params);
  };

  removeDocument = async (params: { agentId: string; id: string }) => {
    return lambdaClient.agentDocument.removeDocument.mutate(params);
  };

  copyDocument = async (params: { agentId: string; id: string; newTitle?: string }) => {
    return lambdaClient.agentDocument.copyDocument.mutate(params);
  };

  renameDocument = async (params: { agentId: string; id: string; newTitle: string }) => {
    return lambdaClient.agentDocument.renameDocument.mutate(params);
  };

  updateLoadRule = async (params: {
    agentId: string;
    id: string;
    rule: {
      keywordMatchMode?: 'all' | 'any';
      keywords?: string[];
      maxTokens?: number;
      policyLoadFormat?: DocumentLoadFormat;
      priority?: number;
      regexp?: string;
      rule?: DocumentLoadRule;
      timeRange?: {
        from?: string;
        to?: string;
      };
    };
  }) => {
    return lambdaClient.agentDocument.updateLoadRule.mutate(params);
  };
}

export const agentDocumentService = new AgentDocumentService();
