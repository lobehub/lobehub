import {
  addIdentityJsonSchema,
  contextMemoryJsonSchema,
  experienceMemoryJsonSchema,
  preferenceMemoryJsonSchema,
  removeIdentityJsonSchema,
  searchMemoryJsonSchema,
  updateIdentityJsonSchema,
} from '@lobechat/memory-user-memory/schemas';
import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { MemoryApiName } from './types';

export const MemoryIdentifier = 'lobe-user-memory';

export const MemoryManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Retrieve memories based on a search query. Use this to recall previously saved information.',
      name: MemoryApiName.searchUserMemory,
      parameters: searchMemoryJsonSchema,
    },
    {
      description:
        'Create a context memory that captures ongoing situations, projects, or environments. Include actors, resources, statuses, urgency/impact, and a clear description.',
      name: MemoryApiName.addContextMemory,
      parameters: contextMemoryJsonSchema,
    },
    {
      description:
        'Record an experience memory capturing situation, actions, reasoning, outcomes, and confidence. Use for lessons, playbooks, or transferable know-how.',
      name: MemoryApiName.addExperienceMemory,
      parameters: experienceMemoryJsonSchema,
    },
    {
      description:
        'Add an identity memory describing enduring facts about a person, their role, relationship, and supporting evidence. Use to track self/others identities.',
      name: MemoryApiName.addIdentityMemory,
      parameters: addIdentityJsonSchema,
    },
    {
      description:
        'Create a preference memory that encodes durable directives or choices the assistant should follow. Include conclusionDirectives, scopes, and context.',
      name: MemoryApiName.addPreferenceMemory,
      parameters: preferenceMemoryJsonSchema,
    },
    {
      description:
        'Update an existing identity memory with refined details, relationships, roles, or tags. Use mergeStrategy to control replacement vs merge.',
      name: MemoryApiName.updateIdentityMemory,
      parameters: updateIdentityJsonSchema,
    },
    {
      description:
        'Remove an identity memory when it is incorrect, obsolete, or duplicated. Always provide a concise reason.',
      name: MemoryApiName.removeIdentityMemory,
      parameters: removeIdentityJsonSchema,
    },
  ],
  identifier: 'lobe-user-memory',
  meta: {
    avatar: '🧠',
    title: 'Memory',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};

/** @deprecated Use MemoryManifest instead */
export const UserMemoryManifest = MemoryManifest;
