import { type NewUserMemoryIdentity } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class MemoryCRUDService {
  // ============ Identity CRUD ============

  createIdentity = async (data: NewUserMemoryIdentity) => {
    return lambdaClient.userMemory.createIdentity.mutate(data);
  };

  deleteIdentity = async (id: string) => {
    return lambdaClient.userMemory.deleteIdentity.mutate({ id });
  };

  getIdentities = async () => {
    return lambdaClient.userMemory.getIdentities.query();
  };

  updateIdentity = async (id: string, data: Partial<NewUserMemoryIdentity>) => {
    return lambdaClient.userMemory.updateIdentity.mutate({ data, id });
  };

  // ============ Context CRUD ============

  deleteContext = async (id: string) => {
    return lambdaClient.userMemory.deleteContext.mutate({ id });
  };

  getContexts = async () => {
    return lambdaClient.userMemory.getContexts.query();
  };

  updateContext = async (
    id: string,
    data: { currentStatus?: string; description?: string; title?: string },
  ) => {
    return lambdaClient.userMemory.updateContext.mutate({ data, id });
  };

  // ============ Experience CRUD ============

  deleteExperience = async (id: string) => {
    return lambdaClient.userMemory.deleteExperience.mutate({ id });
  };

  getExperiences = async () => {
    return lambdaClient.userMemory.getExperiences.query();
  };

  updateExperience = async (
    id: string,
    data: { action?: string; keyLearning?: string; situation?: string },
  ) => {
    return lambdaClient.userMemory.updateExperience.mutate({ data, id });
  };

  // ============ Preference CRUD ============

  deletePreference = async (id: string) => {
    return lambdaClient.userMemory.deletePreference.mutate({ id });
  };

  getPreferences = async () => {
    return lambdaClient.userMemory.getPreferences.query();
  };

  updatePreference = async (
    id: string,
    data: { conclusionDirectives?: string; suggestions?: string },
  ) => {
    return lambdaClient.userMemory.updatePreference.mutate({ data, id });
  };
}

export const memoryCRUDService = new MemoryCRUDService();
