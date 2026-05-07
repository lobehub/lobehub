import type { BuiltinToolManifest } from '@lobechat/types';

import { SkillMaintainerApiName, SkillMaintainerIdentifier } from './types';

const skillTargetProperties = {
  agentDocumentId: {
    description: 'Managed skill bundle id from agent_documents.id.',
    type: 'string',
  },
  name: {
    description: 'Stable managed skill bundle name.',
    type: 'string',
  },
} as const;

const skillBodyMarkdownProperty = {
  description: 'Markdown body for SKILL.md. Do not include YAML frontmatter.',
  type: 'string',
} as const;

/**
 * System-only builtin manifest for automatic skill maintenance.
 *
 * Use when:
 * - Agent Signal delegates skill creation, refinement, or rename work to a hidden worker.
 * - A hidden system surface needs document-backed skill-management APIs.
 *
 * Expects:
 * - Calls are made by trusted orchestration code
 *
 * Returns:
 * - A hidden builtin tool manifest with maintainer APIs
 */
export const SkillMaintainerManifest: BuiltinToolManifest = {
  api: [
    {
      description: 'List managed skills for the current agent.',
      name: SkillMaintainerApiName.listSkills,
      parameters: {
        properties: {},
        required: [],
        type: 'object',
      },
    },
    {
      description: 'Read one managed skill bundle and its SKILL.md index.',
      name: SkillMaintainerApiName.getSkill,
      parameters: {
        properties: {
          includeContent: { type: 'boolean' },
          ...skillTargetProperties,
        },
        required: [],
        type: 'object',
      },
    },
    {
      description: 'Create a managed skill bundle and SKILL.md index.',
      name: SkillMaintainerApiName.createSkill,
      parameters: {
        properties: {
          bodyMarkdown: skillBodyMarkdownProperty,
          description: { type: 'string' },
          name: { type: 'string' },
          sourceAgentDocumentId: {
            description: 'Existing hinted agent document id from agent_documents.id.',
            type: 'string',
          },
          title: { type: 'string' },
        },
        required: ['name', 'title', 'description', 'bodyMarkdown'],
        type: 'object',
      },
    },
    {
      description: 'Replace the SKILL.md index content for a managed skill.',
      name: SkillMaintainerApiName.replaceSkillIndex,
      parameters: {
        properties: {
          bodyMarkdown: skillBodyMarkdownProperty,
          description: { type: 'string' },
          reason: { type: 'string' },
          ...skillTargetProperties,
        },
        required: ['bodyMarkdown'],
        type: 'object',
      },
    },
    {
      description: 'Rename a managed skill bundle and synchronize SKILL.md frontmatter.',
      name: SkillMaintainerApiName.renameSkill,
      parameters: {
        properties: {
          newName: { type: 'string' },
          newTitle: { type: 'string' },
          reason: { type: 'string' },
          ...skillTargetProperties,
        },
        required: [],
        type: 'object',
      },
    },
  ],
  identifier: SkillMaintainerIdentifier,
  meta: {
    description:
      'Run hidden Agent Signal maintenance actions for document-backed skill management.',
    title: 'Skill Maintainer',
  },
  systemRole:
    'Maintain skills through Agent Signal using only list/get/create/replace/rename operations. This tool is system-only and cannot delete skills or manage skill resources.',
  type: 'builtin',
};
