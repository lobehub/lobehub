import { lambdaClient } from '@/libs/trpc/client';
import { type CreateKnowledgeBaseParams } from '@/types/knowledgeBase';

class KnowledgeBaseService {
  createKnowledgeBase = async (params: CreateKnowledgeBaseParams) => {
    return lambdaClient.knowledgeBase.createKnowledgeBase.mutate(params);
  };

  getKnowledgeBaseList = async (visibility?: 'private' | 'public') => {
    return lambdaClient.knowledgeBase.getKnowledgeBases.query(
      visibility ? { visibility } : undefined,
    );
  };

  getKnowledgeBaseById = async (id: string) => {
    return lambdaClient.knowledgeBase.getKnowledgeBaseById.query({ id });
  };

  updateKnowledgeBaseList = async (id: string, value: any) => {
    return lambdaClient.knowledgeBase.updateKnowledgeBase.mutate({ id, value });
  };

  deleteKnowledgeBase = async (id: string) => {
    return lambdaClient.knowledgeBase.removeKnowledgeBase.mutate({ id });
  };

  transferKnowledgeBase = async (
    id: string,
    targetWorkspaceId: string | null,
    targetVisibility?: 'private' | 'public',
  ) => {
    return lambdaClient.knowledgeBase.transferKnowledgeBase.mutate({
      id,
      targetVisibility,
      targetWorkspaceId,
    });
  };

  copyKnowledgeBaseToWorkspace = async (
    id: string,
    targetWorkspaceId: string | null,
    targetVisibility?: 'private' | 'public',
  ) => {
    return lambdaClient.knowledgeBase.copyKnowledgeBaseToWorkspace.mutate({
      id,
      targetVisibility,
      targetWorkspaceId,
    });
  };

  publishKnowledgeBaseToWorkspace = async (id: string) => {
    return lambdaClient.knowledgeBase.publishKnowledgeBaseToWorkspace.mutate({ id });
  };

  setKnowledgeBaseVisibility = async (id: string, visibility: 'private' | 'public') => {
    return lambdaClient.knowledgeBase.setKnowledgeBaseVisibility.mutate({ id, visibility });
  };

  addFilesToKnowledgeBase = async (knowledgeBaseId: string, ids: string[]) => {
    return lambdaClient.knowledgeBase.addFilesToKnowledgeBase.mutate({ ids, knowledgeBaseId });
  };

  removeFilesFromKnowledgeBase = async (knowledgeBaseId: string, ids: string[]) => {
    return lambdaClient.knowledgeBase.removeFilesFromKnowledgeBase.mutate({ ids, knowledgeBaseId });
  };
}

export const knowledgeBaseService = new KnowledgeBaseService();
