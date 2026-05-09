import { AgentDocumentVfsError } from '@/server/services/agentDocumentVfs/errors';

import { SkillMountPathResolver } from './SkillMountPathResolver';
import type { ResolvedSkillMountPath, SkillMountContext, SkillMountNode } from './types';

export interface CreateSkillInput {
  agentId: string;
  content: string;
  skillName: string;
  targetNamespace: 'agent';
  topicId?: string;
}

export interface UpdateSkillInput {
  agentId: string;
  content: string;
  path: string;
  topicId?: string;
}

export interface DeleteSkillInput {
  agentId: string;
  path: string;
  topicId?: string;
}

export interface SkillMountProvider {
  get: (input: SkillMountProviderRequest) => Promise<SkillMountNode>;
  list: (input: SkillMountProviderRequest) => Promise<SkillMountNode[]>;
}

export interface WritableSkillMountProvider extends SkillMountProvider {
  create: (input: CreateSkillInput) => Promise<SkillMountNode>;
  delete: (input: DeleteSkillInput) => Promise<void>;
  update: (input: UpdateSkillInput) => Promise<SkillMountNode>;
}

export interface SkillMountProviderRequest extends SkillMountContext {
  path: string;
  resolvedPath: ResolvedSkillMountPath;
}

export type SkillMountProviderRegistry = Partial<
  Record<SkillMountNode['namespace'], SkillMountProvider>
>;

export class SkillMount {
  constructor(private readonly providers: SkillMountProviderRegistry = {}) {}

  async list(input: { agentId: string; path: string; topicId?: string }) {
    const resolvedPath = SkillMountPathResolver.resolve(input.path);
    const provider = this.getProvider(resolvedPath.namespace);

    return provider.list({
      agentId: input.agentId,
      topicId: input.topicId,
      path: input.path,
      resolvedPath,
    });
  }

  async get(input: { agentId: string; path: string; topicId?: string }) {
    const resolvedPath = SkillMountPathResolver.resolve(input.path);
    const provider = this.getProvider(resolvedPath.namespace);

    return provider.get({
      agentId: input.agentId,
      topicId: input.topicId,
      path: input.path,
      resolvedPath,
    });
  }

  async create(input: CreateSkillInput) {
    const provider = this.getWritableProviderByNamespace(input.targetNamespace);

    return provider.create(input);
  }

  async update(input: UpdateSkillInput) {
    const provider = this.getWritableProviderByPath(input.path);

    return provider.update(input);
  }

  async delete(input: DeleteSkillInput) {
    const provider = this.getWritableProviderByPath(input.path);

    return provider.delete(input);
  }

  private getProvider(namespace: SkillMountNode['namespace']) {
    const provider = this.providers[namespace];

    if (!provider) {
      throw new AgentDocumentVfsError(
        `No provider registered for namespace "${namespace}"`,
        'NOT_FOUND',
      );
    }

    return provider;
  }

  private getWritableProviderByNamespace(namespace: CreateSkillInput['targetNamespace']) {
    const provider = this.providers[namespace];

    if (!this.isWritableProvider(provider)) {
      throw new AgentDocumentVfsError(`Namespace "${namespace}" is not writable`, 'FORBIDDEN');
    }

    return provider;
  }

  private getWritableProviderByPath(path: string) {
    const { namespace } = SkillMountPathResolver.resolve(path);
    const provider = this.providers[namespace];

    if (!this.isWritableProvider(provider)) {
      throw new AgentDocumentVfsError(`Namespace "${namespace}" is not writable`, 'FORBIDDEN');
    }

    return provider;
  }

  private isWritableProvider(
    provider?: SkillMountProvider,
  ): provider is WritableSkillMountProvider {
    return !!provider && 'create' in provider && 'delete' in provider && 'update' in provider;
  }
}
