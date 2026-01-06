import type {
  IdentityMemoryDetail,
  UserMemoryContextWithoutVectors,
  UserMemoryExperienceWithoutVectors,
  UserMemoryPreferenceWithoutVectors,
} from '@lobechat/types';
import { u } from 'unist-builder';
import { toXml } from 'xast-util-to-xml';
import type { Child } from 'xastscript';
import { x } from 'xastscript';

import type { BuiltContext, MemoryContextProvider, MemoryExtractionJob } from '../types';

interface RetrievedMemories {
  contexts: UserMemoryContextWithoutVectors[];
  experiences: UserMemoryExperienceWithoutVectors[];
  preferences: UserMemoryPreferenceWithoutVectors[];
}

interface RetrievedIdentitiesOptions {
  fetchedAt?: number;
  retrievedIdentities: IdentityMemoryDetail[];
}

export class RetrievalUserMemoryContextProvider implements MemoryContextProvider {
  readonly retrievedMemories: RetrievedMemories;
  readonly fetchedAt?: number;

  constructor(options: { fetchedAt?: number; retrievedMemories: RetrievedMemories }) {
    this.retrievedMemories = options.retrievedMemories;
    this.fetchedAt = options.fetchedAt;
  }

  async buildContext(job: MemoryExtractionJob): Promise<BuiltContext> {
    const contexts = this.retrievedMemories.contexts || [];
    const experiences = this.retrievedMemories.experiences || [];
    const preferences = this.retrievedMemories.preferences || [];

    const userMemoriesChildren: Child[] = [];

    contexts.forEach((context) => {
      const attributes: Record<string, string> = { id: context.id ?? '' };
      const similarity = (context as { similarity?: number }).similarity;

      if (typeof similarity === 'number') {
        attributes.similarity = similarity.toFixed(3);
      }
      if (context.type) {
        attributes.type = context.type;
      }

      const children: Child[] = [
        x('context_title', context.title ?? ''),
        x('context_description', context.description ?? ''),
      ];

      if (context.currentStatus) {
        children.push(x('context_current_status', context.currentStatus));
      }
      if (Array.isArray(context.tags) && context.tags.length > 0) {
        children.push(x('context_tags', context.tags.join(', ')));
      }

      userMemoriesChildren.push(x('user_memories_context', attributes, ...children));
    });

    experiences.forEach((experience) => {
      const attributes: Record<string, string> = { id: experience.id ?? '' };
      const similarity = (experience as { similarity?: number }).similarity;

      if (typeof similarity === 'number') {
        attributes.similarity = similarity.toFixed(3);
      }
      if (experience.type) {
        attributes.type = experience.type;
      }

      const children: Child[] = [
        x('experience_situation', experience.situation ?? ''),
        x('experience_key_learning', experience.keyLearning ?? ''),
      ];

      if (experience.action) {
        children.push(x('experience_action', experience.action));
      }
      if (experience.reasoning) {
        children.push(x('experience_reasoning', experience.reasoning));
      }
      if (experience.possibleOutcome) {
        children.push(x('experience_possible_outcome', experience.possibleOutcome));
      }
      if (Array.isArray(experience.tags) && experience.tags.length > 0) {
        children.push(x('experience_tags', experience.tags.join(', ')));
      }

      userMemoriesChildren.push(x('user_memories_experience', attributes, ...children));
    });

    preferences.forEach((preference) => {
      const attributes: Record<string, string> = { id: preference.id ?? '' };
      const similarity = (preference as { similarity?: number }).similarity;

      if (typeof similarity === 'number') {
        attributes.similarity = similarity.toFixed(3);
      }
      if (preference.type) {
        attributes.type = preference.type;
      }

      const children: Child[] = [
        x('preference_conclusion_directives', preference.conclusionDirectives ?? ''),
      ];

      if (preference.suggestions) {
        children.push(x('preference_suggestions', preference.suggestions));
      }
      if (Array.isArray(preference.tags) && preference.tags.length > 0) {
        children.push(x('preference_tags', preference.tags.join(', ')));
      }

      userMemoriesChildren.push(x('user_memories_preference', attributes, ...children));
    });

    const memoryContext = toXml(
      u('root', [
        x(
          'user_memories',
          {
            contexts: contexts.length.toString(),
            experiences: experiences.length.toString(),
            memory_fetched_at: new Date(this.fetchedAt ?? Date.now()).toISOString(),
            preferences: preferences.length.toString(),
          },
          ...userMemoriesChildren,
        ),
      ]),
    );

    return {
      context: memoryContext,
      metadata: {},
      sourceId: job.sourceId,
      userId: job.userId,
    };
  }
}

export class RetrievalUserMemoryIdentitiesProvider implements MemoryContextProvider {
  readonly retrievedIdentities: IdentityMemoryDetail[];
  readonly fetchedAt?: number;

  constructor(options: RetrievedIdentitiesOptions) {
    this.retrievedIdentities = options.retrievedIdentities;
    this.fetchedAt = options.fetchedAt;
  }

  async buildContext(job: MemoryExtractionJob): Promise<BuiltContext> {
    const identityChildren: Child[] = [];

    this.retrievedIdentities.forEach((item) => {
      const { identity, memory } = item;
      const attributes: Record<string, string> = { id: identity.id ?? '' };

      if (identity.userMemoryId) {
        attributes.user_memory_id = identity.userMemoryId;
      }
      if (memory.id) {
        attributes.memory_id = memory.id;
      }
      if (identity.relationship) {
        attributes.relationship = identity.relationship;
      }
      if (identity.role) {
        attributes.role = identity.role;
      }
      if (identity.type) {
        attributes.type = identity.type;
      }
      if (identity.episodicDate) {
        attributes.episodic_date = new Date(identity.episodicDate).toISOString();
      }
      if (memory.memoryCategory) {
        attributes.memory_category = memory.memoryCategory;
      }
      if (memory.memoryType) {
        attributes.memory_type = memory.memoryType;
      }

      const children: Child[] = [];

      if (identity.description) {
        children.push(x('identity_description', identity.description));
      }
      if (Array.isArray(identity.tags) && identity.tags.length > 0) {
        children.push(x('identity_tags', identity.tags.join(', ')));
      }
      if (identity.metadata) {
        children.push(x('identity_metadata', JSON.stringify(identity.metadata)));
      }
      if (memory.title) {
        children.push(x('identity_memory_title', memory.title));
      }
      if (memory.summary) {
        children.push(x('identity_memory_summary', memory.summary));
      }
      if (memory.details) {
        children.push(x('identity_memory_details', memory.details));
      }
      if (Array.isArray(memory.tags) && memory.tags.length > 0) {
        children.push(x('identity_memory_tags', memory.tags.join(', ')));
      }
      if (memory.metadata) {
        children.push(x('identity_memory_metadata', JSON.stringify(memory.metadata)));
      }

      identityChildren.push(x('user_memories_identity', attributes, ...children));
    });

    const identityContext = toXml(
      u('root', [
        x(
          'user_memories_identities',
          {
            identities: this.retrievedIdentities.length.toString(),
            memory_fetched_at: new Date(this.fetchedAt ?? Date.now()).toISOString(),
          },
          ...identityChildren,
        ),
      ]),
    );

    return {
      context: identityContext,
      metadata: {},
      sourceId: job.sourceId,
      userId: job.userId,
    };
  }
}
