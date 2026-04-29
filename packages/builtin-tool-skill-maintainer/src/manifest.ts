import type { BuiltinToolManifest } from '@lobechat/types';

import { SkillMaintainerApiName, SkillMaintainerIdentifier } from './types';

const skillRefProperties = {
  skillRef: { type: 'string' },
} as const;

const filePathProperties = {
  path: { type: 'string' },
  ...skillRefProperties,
} as const;

/**
 * System-only builtin manifest for automatic skill maintenance.
 *
 * Use when:
 * - Agent Signal delegates refinement or consolidation to maintainer tools
 * - A hidden system surface needs merge orchestration APIs
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
      description: 'Read one package-relative file from a managed skill.',
      name: SkillMaintainerApiName.readSkillFile,
      parameters: {
        properties: filePathProperties,
        required: ['skillRef', 'path'],
        type: 'object',
      },
    },
    {
      description: 'Update one existing package-relative file in a managed skill.',
      name: SkillMaintainerApiName.updateSkill,
      parameters: {
        properties: {
          content: { type: 'string' },
          reason: { type: 'string' },
          ...filePathProperties,
        },
        required: ['skillRef', 'path', 'content', 'reason'],
        type: 'object',
      },
    },
    {
      description: 'Write one package-relative file in a managed skill.',
      name: SkillMaintainerApiName.writeSkillFile,
      parameters: {
        properties: {
          content: { type: 'string' },
          reason: { type: 'string' },
          ...filePathProperties,
        },
        required: ['skillRef', 'path', 'content', 'reason'],
        type: 'object',
      },
    },
    {
      description: 'Remove one package-relative file from a managed skill.',
      name: SkillMaintainerApiName.removeSkillFile,
      parameters: {
        properties: {
          reason: { type: 'string' },
          ...filePathProperties,
        },
        required: ['skillRef', 'path', 'reason'],
        type: 'object',
      },
    },
    {
      description: 'Run single-skill refinement for a target skill reference.',
      name: SkillMaintainerApiName.refine,
      parameters: {
        properties: {
          reason: { type: 'string' },
          skillRef: { type: 'string' },
        },
        required: ['skillRef', 'reason'],
        type: 'object',
      },
    },
    {
      description: 'Find and reconcile overlapping skills.',
      name: SkillMaintainerApiName.consolidate,
      parameters: {
        properties: {
          reason: { type: 'string' },
          sourceSkillIds: { items: { type: 'string' }, type: 'array' },
        },
        required: ['sourceSkillIds'],
        type: 'object',
      },
    },
  ],
  identifier: SkillMaintainerIdentifier,
  meta: {
    description:
      'Run hidden Agent Signal maintenance actions for skill refinement and consolidation.',
    title: 'Skill Maintainer',
  },
  systemRole: 'Maintain skills through Agent Signal. This tool is system-only.',
  type: 'builtin',
};
