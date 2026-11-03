import type { SkillMountNode } from './types';

export type SkillNamespace = SkillMountNode['namespace'];

export const SKILL_NAMESPACES = [
  'agent',
  'builtin',
  'installed-active',
  'installed-all',
] as const satisfies readonly SkillNamespace[];

const UNIFIED_SKILL_ROOT_PREFIX = './lobe/skills';

const SKILL_NAMESPACE_SEGMENTS = {
  'agent': ['agent', 'skills'],
  'builtin': ['builtin', 'skills'],
  'installed-active': ['installed', 'active', 'skills'],
  'installed-all': ['installed', 'all', 'skills'],
} as const satisfies Record<SkillNamespace, readonly string[]>;

/**
 * Returns the target unified skill mount root for a namespace.
 *
 * Use when:
 * - Producing VFS nodes from skill providers.
 * - Comparing mounted subtree paths inside the unified agent-document VFS.
 *
 * Expects:
 * - `namespace` is one registered skill namespace.
 *
 * Returns:
 * - A path such as `./lobe/skills/agent/skills`.
 */
export const getUnifiedSkillNamespaceRootPath = (namespace: SkillNamespace) =>
  `${UNIFIED_SKILL_ROOT_PREFIX}/${SKILL_NAMESPACE_SEGMENTS[namespace].join('/')}`;

/**
 * Returns the parent directory that contains a skill namespace root.
 *
 * Use when:
 * - Rendering synthetic namespace directories before the provider-owned root.
 *
 * Expects:
 * - `namespace` is one registered skill namespace.
 *
 * Returns:
 * - A path such as `./lobe/skills/installed/active`.
 */
export const getUnifiedSkillNamespaceParentPath = (namespace: SkillNamespace) =>
  `${UNIFIED_SKILL_ROOT_PREFIX}/${SKILL_NAMESPACE_SEGMENTS[namespace].slice(0, -1).join('/')}`;

export const isUnifiedSkillPath = (path: string) =>
  path === UNIFIED_SKILL_ROOT_PREFIX || path.startsWith(`${UNIFIED_SKILL_ROOT_PREFIX}/`);
