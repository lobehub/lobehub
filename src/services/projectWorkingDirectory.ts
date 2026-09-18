import { lambdaClient } from '@/libs/trpc/client';

type Client = typeof lambdaClient.projectWorkingDirectory;
export type BindProjectDirectoryInput = Parameters<Client['bind']['mutate']>[0];

class ProjectWorkingDirectoryService {
  listProjectTopics = (projectId: string) =>
    lambdaClient.projectWorkingDirectory.listProjectTopics.query({ projectId });
  createProjectTopic = (input: Parameters<Client['createProjectTopic']['mutate']>[0]) =>
    lambdaClient.projectWorkingDirectory.createProjectTopic.mutate(input);
  associateTopic = (input: Parameters<Client['associateTopic']['mutate']>[0]) =>
    lambdaClient.projectWorkingDirectory.associateTopic.mutate(input);
  listEnvironments = (projectId?: string) =>
    lambdaClient.projectWorkingDirectory.listEnvironments.query({ projectId });
  saveEnvironment = (input: Parameters<Client['saveEnvironment']['mutate']>[0]) =>
    lambdaClient.projectWorkingDirectory.saveEnvironment.mutate(input);
  attachEnvironment = (projectId: string, environmentId: string) =>
    lambdaClient.projectWorkingDirectory.attachEnvironment.mutate({ projectId, environmentId });
  bind = (input: BindProjectDirectoryInput) =>
    lambdaClient.projectWorkingDirectory.bind.mutate(input);
  list = (projectId?: string) => lambdaClient.projectWorkingDirectory.list.query({ projectId });
  listTopics = (id: string) => lambdaClient.projectWorkingDirectory.listTopics.query({ id });
  listEnvironmentTopics = async (directoryIds: string[]) => {
    const responses = await Promise.all(directoryIds.map((id) => this.listTopics(id)));
    return {
      data: responses
        .flatMap((response) => response.data)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      success: true,
    };
  };
  resolve = (id: string) => lambdaClient.projectWorkingDirectory.resolve.query({ id });
  startTopic = (input: Parameters<Client['startTopic']['mutate']>[0]) =>
    lambdaClient.projectWorkingDirectory.startTopic.mutate(input);
}
export const projectWorkingDirectoryService = new ProjectWorkingDirectoryService();
