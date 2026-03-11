import { LayersEnum, MemorySourceType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  RetrievalUserMemoryContextProvider,
  RetrievalUserMemoryIdentitiesProvider,
} from './existingUserMemory';

const job = {
  source: MemorySourceType.ChatTopic,
  sourceId: 'topic-1',
  userId: 'user-1',
};

describe('RetrievalUserMemoryContextProvider', () => {
  it('should build XML memory context with counts and attributes', async () => {
    const fetchedAt = new Date('2024-02-01T00:00:00.000Z').valueOf();

    const provider = new RetrievalUserMemoryContextProvider({
      fetchedAt,
      retrievedMemories: {
        activities: [
          {
            accessedAt: new Date(),
            type: 'meeting',
            associatedLocations: [{ name: 'Zoom' }],
            associatedSubjects: [{ name: 'Alice', type: 'person' }],
            capturedAt: new Date(),
            createdAt: new Date(),
            endsAt: new Date('2024-02-01T02:00:00.000Z'),
            feedback: 'Felt good',
            id: 'act-1',
            metadata: {},
            narrative: 'Weekly sync about roadmap',
            notes: 'Agenda: roadmap',
            startsAt: new Date('2024-02-01T01:00:00.000Z'),
            status: 'completed',
            tags: ['meeting'],
            timezone: 'UTC',
            updatedAt: new Date(),
            userId: 'user-1',
            userMemoryId: 'mem-act-1',
          } as any,
        ],
        contexts: [
          {
            accessedAt: new Date(),
            associatedObjects: [],
            associatedSubjects: [],
            createdAt: new Date(),
            currentStatus: 'active',
            description: 'Weekly syncs for LobeHub',
            id: 'ctx-1',
            metadata: {},
            scoreImpact: null,
            scoreUrgency: null,
            tags: ['project', 'team'],
            title: 'LobeHub',
            type: 'project',
            updatedAt: new Date(),
            userId: 'user-1',
            userMemoryIds: ['mem-1'],
            // similarity is appended by retrieval pipeline
          } as any,
        ],
        experiences: [
          {
            action: 'Shipped feature',
            actionVector: null,
            accessedAt: new Date(),
            createdAt: new Date(),
            id: 'exp-1',
            keyLearning: 'Ship smaller increments',
            keyLearningVector: null,
            metadata: {},
            possibleOutcome: 'Faster releases',
            reasoning: 'Better agility',
            scoreConfidence: null,
            situation: 'Release planning',
            situationVector: null,
            tags: ['release'],
            type: 'product',
            updatedAt: new Date(),
            userId: 'user-1',
            userMemoryId: 'mem-2',
          } as any,
        ],
        preferences: [
          {
            accessedAt: new Date(),
            conclusionDirectives: 'Always keep updates concise',
            conclusionDirectivesVector: null,
            createdAt: new Date(),
            id: 'pref-1',
            metadata: {},
            scorePriority: null,
            suggestions: 'Use bullet points',
            tags: ['communication'],
            type: 'style',
            updatedAt: new Date(),
            userId: 'user-1',
            userMemoryId: 'mem-3',
          } as any,
        ],
      },
    });

    const result = await provider.buildContext(job.userId, job.sourceId);

    expect(result.sourceId).toBe('topic-1');
    expect(result.userId).toBe('user-1');
    expect(result.metadata).toEqual({});
    expect(result.context).equal(
      '<user_memories activities="1" contexts="1" experiences="1" memory_fetched_at="2024-02-01T00:00:00.000Z" preferences="1"><user_memories_activity id="act-1" activity_type="meeting" status="completed" timezone="UTC" starts_at="2024-02-01T01:00:00.000Z" ends_at="2024-02-01T02:00:00.000Z"><activity_narrative>Weekly sync about roadmap</activity_narrative><activity_notes>Agenda: roadmap</activity_notes><activity_feedback>Felt good</activity_feedback><activity_associated_location>Zoom</activity_associated_location><activity_associated_subject>Alice | type: person</activity_associated_subject><activity_tags>meeting</activity_tags></user_memories_activity><user_memories_context id="ctx-1" type="project"><context_title>LobeHub</context_title><context_description>Weekly syncs for LobeHub</context_description><context_current_status>active</context_current_status><context_tags>project, team</context_tags></user_memories_context><user_memories_experience id="exp-1" type="product"><experience_situation>Release planning</experience_situation><experience_key_learning>Ship smaller increments</experience_key_learning><experience_action>Shipped feature</experience_action><experience_reasoning>Better agility</experience_reasoning><experience_possible_outcome>Faster releases</experience_possible_outcome><experience_tags>release</experience_tags></user_memories_experience><user_memories_preference id="pref-1" type="style"><preference_conclusion_directives>Always keep updates concise</preference_conclusion_directives><preference_suggestions>Use bullet points</preference_suggestions><preference_tags>communication</preference_tags></user_memories_preference></user_memories>',
    );
  });
});

describe('RetrievalUserMemoryIdentitiesProvider', () => {
  it('should build XML identities context with metadata and fetched time', async () => {
    const fetchedAt = new Date('2024-02-01T00:00:00.000Z').valueOf();

    const provider = new RetrievalUserMemoryIdentitiesProvider({
      fetchedAt,
      retrievedIdentities: [
        {
          identity: {
            accessedAt: new Date(),
            createdAt: new Date(),
            description: 'Worked with user on onboarding',
            episodicDate: new Date('2023-05-20T00:00:00.000Z'),
            id: 'identity-1',
            metadata: { project: 'LobeHub' },
            relationship: 'colleague',
            role: 'developer advocate',
            tags: ['onboarding'],
            type: 'professional',
            updatedAt: new Date(),
            userId: 'user-1',
            userMemoryId: 'mem-identity-1',
          },
          layer: LayersEnum.Identity,
          memory: {
            accessedAt: new Date(),
            accessedCount: 1,
            capturedAt: new Date('2023-05-19T00:00:00.000Z'),
            createdAt: new Date(),
            details: 'Detailed onboarding collaboration',
            id: 'mem-identity-1',
            lastAccessedAt: new Date(),
            memoryCategory: 'people',
            memoryLayer: 'identity',
            memoryType: 'people',
            metadata: { topic: 'onboarding' },
            status: 'active',
            summary: 'Supported onboarding as developer advocate',
            tags: ['onboarding', 'support'],
            title: 'Developer advocate for onboarding',
            updatedAt: new Date(),
            userId: 'user-1',
          },
        },
      ],
    });

    const result = await provider.buildContext(job.userId, job.sourceId);

    expect(result.sourceId).toBe('topic-1');
    expect(result.userId).toBe('user-1');
    expect(result.metadata).toEqual({});
    expect(result.context).equal(
      '<user_memories_identities identities="1" memory_fetched_at="2024-02-01T00:00:00.000Z"><user_memories_identity id="identity-1" user_memory_id="mem-identity-1" memory_id="mem-identity-1" relationship="colleague" role="developer advocate" type="professional" episodic_date="2023-05-20T00:00:00.000Z" memory_category="people" memory_type="people"><identity_description>Worked with user on onboarding</identity_description><identity_tags>onboarding</identity_tags><identity_metadata>{"project":"LobeHub"}</identity_metadata><identity_memory_title>Developer advocate for onboarding</identity_memory_title><identity_memory_summary>Supported onboarding as developer advocate</identity_memory_summary><identity_memory_details>Detailed onboarding collaboration</identity_memory_details><identity_memory_tags>onboarding, support</identity_memory_tags><identity_memory_metadata>{"topic":"onboarding"}</identity_memory_metadata></user_memories_identity></user_memories_identities>',
    );
  });
});
