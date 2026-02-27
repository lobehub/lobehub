import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { SkillStoreApiName, SkillStoreIdentifier } from './types';

export const SkillStoreManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        "Search for skills in the LobeHub Market. Use this to discover available skills that can extend Claude's capabilities. Search across skill names, descriptions, and summaries. Results can be filtered and sorted by various criteria (stars, downloads, etc).",
      name: SkillStoreApiName.searchSkill,
      parameters: {
        properties: {
          locale: {
            description: 'Locale for search results (e.g., "en-US", "zh-CN"). Optional.',
            type: 'string',
          },
          order: {
            description: 'Sort order: "asc" for ascending, "desc" for descending. Default: "desc".',
            enum: ['asc', 'desc'],
            type: 'string',
          },
          page: {
            description: 'Page number for pagination. Default: 1.',
            type: 'number',
          },
          pageSize: {
            description: 'Number of results per page. Default: 20.',
            type: 'number',
          },
          q: {
            description:
              'Search query to filter skills. Searches across skill name, description, and summary. Optional.',
            type: 'string',
          },
          sort: {
            description:
              'Field to sort by. Options: createdAt (creation date), installCount (installs), forks (GitHub forks), name (alphabetical), relevance (search relevance), stars (GitHub stars), updatedAt (last update), watchers (GitHub watchers). Default: "updatedAt".',
            enum: [
              'createdAt',
              'forks',
              'installCount',
              'name',
              'relevance',
              'stars',
              'updatedAt',
              'watchers',
            ],
            type: 'string',
          },
        },
        type: 'object',
      },
    },
    {
      description:
        'Import/install a skill directly from the LobeHub Market using its identifier. This is the recommended way to install skills from the market after searching with searchSkill. The skill will be downloaded and installed automatically. Requires user confirmation before installation.',
      humanIntervention: 'required',
      name: SkillStoreApiName.importFromMarket,
      parameters: {
        properties: {
          identifier: {
            description:
              'The unique identifier of the skill in the market (e.g., "github.anthropics.skills.skills.skill-creator"). You can get this from searchSkill results.',
            type: 'string',
          },
        },
        required: ['identifier'],
        type: 'object',
      },
    },
    {
      description:
        'Import/install a skill from a URL. Supports SKILL.md URLs, GitHub repository URLs, and ZIP package URLs. Requires user confirmation before installation.',
      humanIntervention: 'required',
      name: SkillStoreApiName.importSkill,
      parameters: {
        properties: {
          type: {
            description:
              'The type of the URL: "url" for SKILL.md or GitHub links, "zip" for ZIP package URLs.',
            enum: ['url', 'zip'],
            type: 'string',
          },
          url: {
            description: 'The URL of the skill resource to import.',
            type: 'string',
          },
        },
        required: ['url', 'type'],
        type: 'object',
      },
    },
  ],
  identifier: SkillStoreIdentifier,
  meta: {
    avatar: '🏪',
    description: 'Browse and install agent skills from the LobeHub marketplace',
    title: 'Skill Store',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
