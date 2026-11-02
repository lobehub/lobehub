import { builtinSkills } from '@lobechat/builtin-skills';
import { resourcesTreePrompt } from '@lobechat/prompts';
import type { RuntimeSelectedSkill, SkillResourceMeta } from '@lobechat/types';

type SelectedSkillSource = NonNullable<RuntimeSelectedSkill['source']>;

export interface ResolvableSkill {
  content?: string | null;
  description?: string | null;
  identifier: string;
  name: string;
  resources?: Record<string, SkillResourceMeta> | null;
  source?: string | null;
}

interface ResolveSelectedSkillIdsParams {
  findAgentSkill?: (identifier: string) => Promise<ResolvableSkill | undefined>;
  findUserSkill: (identifier: string) => Promise<ResolvableSkill | undefined>;
  ids?: string[];
  selectedSkills?: RuntimeSelectedSkill[];
}

const toSelectedSource = (source?: string | null): SelectedSkillSource => {
  if (source === 'builtin' || source === 'market' || source === 'user') return source;
  if (source === 'device' || source === 'project') return source;
  return 'user';
};

/**
 * Selected skills cross the operation boundary as stable metadata. Keep inline
 * resource bodies out of that payload; readReference loads them on demand.
 */
const toReferenceResources = (
  resources?: Record<string, SkillResourceMeta> | null,
): Record<string, SkillResourceMeta> | undefined => {
  const entries = Object.entries(resources ?? {}).map(([path, meta]) => [
    path,
    {
      ...(meta.documentId && { documentId: meta.documentId }),
      fileHash: meta.fileHash,
      size: meta.size,
    },
  ]);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const toRuntimeSelectedSkill = (
  skill: ResolvableSkill,
  source: SelectedSkillSource = toSelectedSource(skill.source),
): RuntimeSelectedSkill | undefined => {
  if (!skill.content) return undefined;

  const resources = toReferenceResources(skill.resources);
  const content =
    resources && Object.keys(resources).length > 0
      ? `${skill.content}\n\n${resourcesTreePrompt(skill.name, resources)}`
      : skill.content;

  return {
    content,
    identifier: skill.identifier,
    name: skill.name,
    ...(resources && { resources }),
    source,
  };
};

/**
 * Resolve CLI/API-selected skill identifiers with the same auto-activation
 * semantics as a slash selection. Existing client-resolved entries win so a
 * caller that already supplied richer content does not trigger another load.
 */
export const resolveSelectedSkillIds = async ({
  findAgentSkill,
  findUserSkill,
  ids,
  selectedSkills,
}: ResolveSelectedSkillIdsParams): Promise<RuntimeSelectedSkill[] | undefined> => {
  if (!ids?.length) return selectedSkills;

  const resolvedById = new Map(
    (selectedSkills ?? []).map((skill) => [skill.identifier, skill] as const),
  );

  for (const identifier of new Set(ids)) {
    const existing = resolvedById.get(identifier);
    if (existing?.content) continue;

    const builtin = builtinSkills.find((skill) => skill.identifier === identifier);
    const userSkill = builtin ? undefined : await findUserSkill(identifier).catch(() => undefined);
    const agentSkill =
      builtin || userSkill ? undefined : await findAgentSkill?.(identifier).catch(() => undefined);
    const resolved =
      (builtin && toRuntimeSelectedSkill(builtin, 'builtin')) ??
      (userSkill && toRuntimeSelectedSkill(userSkill)) ??
      (agentSkill && toRuntimeSelectedSkill(agentSkill, 'user'));

    if (!resolved) continue;

    resolvedById.set(identifier, {
      ...resolved,
      ...existing,
      content: existing?.content ?? resolved.content,
      name: existing?.name ?? resolved.name,
      resources: existing?.resources ?? resolved.resources,
    });
  }

  return resolvedById.size > 0 ? [...resolvedById.values()] : selectedSkills;
};
