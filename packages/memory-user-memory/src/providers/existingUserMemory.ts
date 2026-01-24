import type {
  IdentityMemoryDetail,
  UserMemoryActivityWithoutVectors,
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
  activities: UserMemoryActivityWithoutVectors[];
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

  private formatTags(tags?: unknown) {
    return Array.isArray(tags) && tags.length ? `tags: ${tags.join(', ')}` : '';
  }

  private formatLocation(location: any) {
    if (!location || typeof location !== 'object') return '';
    const parts: string[] = [];

    if (typeof location.name === 'string' && location.name) parts.push(location.name);
    if (typeof location.type === 'string' && location.type) parts.push(`type: ${location.type}`);
    if (typeof location.address === 'string' && location.address) parts.push(location.address);

    const tags = this.formatTags(location.tags);
    if (tags) parts.push(tags);

    return parts.join(' | ');
  }

  private formatAssociation(value: any) {
    if (!value || typeof value !== 'object') return '';
    const parts: string[] = [];

    if (typeof value.name === 'string' && value.name) parts.push(value.name);
    if (typeof value.type === 'string' && value.type) parts.push(`type: ${value.type}`);

    if (value.extra && typeof value.extra === 'object') {
      try {
        parts.push(`extra: ${JSON.stringify(value.extra)}`);
      } catch {
        parts.push('extra: [unserializable]');
      }
    }

    return parts.join(' | ');
  }

  async buildContext(job: MemoryExtractionJob): Promise<BuiltContext> {
    const activities = this.retrievedMemories.activities || [];
    const contexts = this.retrievedMemories.contexts || [];
    const experiences = this.retrievedMemories.experiences || [];
    const preferences = this.retrievedMemories.preferences || [];



    const userMemoriesChildren: Child[] = [];

    activities.forEach((activity) => {
      const attributes: Record<string, string> = { id: activity.id ?? '' };
      const similarity = (activity as { similarity?: number }).similarity;

      if (typeof similarity === 'number') {
        attributes.similarity = similarity.toFixed(3);
      }
      if (activity.type) {
        attributes.activity_type = activity.type;
      }
      if (activity.status) {
        attributes.status = activity.status;
      }
      if (activity.timezone) {
        attributes.timezone = activity.timezone;
      }
      if (activity.startsAt) {
        attributes.starts_at = new Date(activity.startsAt).toISOString();
      }
      if (activity.endsAt) {
        attributes.ends_at = new Date(activity.endsAt).toISOString();
      }

      const children: Child[] = [];
      const legacyLocation = (activity as { location?: unknown }).location;
      const associatedLocations = Array.isArray(activity.associatedLocations)
        ? activity.associatedLocations
        : legacyLocation
          ? [legacyLocation]
          : [];
      const associatedObjects = Array.isArray(activity.associatedObjects)
        ? activity.associatedObjects
        : [];
      const associatedSubjects = Array.isArray(activity.associatedSubjects)
        ? activity.associatedSubjects
        : [];

      if (activity.narrative) {
        children.push(x('activity_narrative', activity.narrative));
      }
      if (activity.notes) {
        children.push(x('activity_notes', activity.notes));
      }
      if (activity.feedback) {
        children.push(x('activity_feedback', activity.feedback));
      }
      associatedLocations.forEach((location) => {
        const value = this.formatLocation(location);
        if (value) {
          children.push(x('activity_associated_location', value));
        }
      });
      associatedObjects.forEach((object) => {
        const value = this.formatAssociation(object);
        if (value) {
          children.push(x('activity_associated_object', value));
        }
      });
      associatedSubjects.forEach((subject) => {
        const value = this.formatAssociation(subject);
        if (value) {
          children.push(x('activity_associated_subject', value));
        }
      });
      if (Array.isArray(activity.tags) && activity.tags.length > 0) {
        children.push(x('activity_tags', activity.tags.join(', ')));
      }

      userMemoriesChildren.push(x('user_memories_activity', attributes, ...children));
    });

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
            activities: activities.length.toString(),
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
