import type { LobeToolManifest, SkillMeta } from '@lobechat/context-engine';
import { formatSelectedSkillsContext, formatSelectedToolsContext } from '@lobechat/context-engine';

/** Gateway matches the browser's persisted selection carrier before its first call. */
export const persistSelectedContext = async ({
  message,
  update,
  skills = [],
  manifests = [],
}: {
  manifests?: LobeToolManifest[];
  message?: {
    content: string;
    id?: string;
    metadata?: { selectedSkillIds?: string[]; selectedToolIds?: string[] } | null;
    role?: string;
  };
  skills?: SkillMeta[];
  update: (id: string, value: { content: string }) => Promise<{ success: boolean }>;
}) => {
  if (!message?.id || message.role !== 'user') return;
  const skillIds = new Set(message.metadata?.selectedSkillIds ?? []);
  const toolIds = new Set(message.metadata?.selectedToolIds ?? []);
  const selectedSkills = message.content.includes('<selected_skill_context>')
    ? null
    : formatSelectedSkillsContext(skills.filter((skill) => skillIds.has(skill.identifier)));
  const selectedTools = message.content.includes('<selected_tool_context>')
    ? null
    : formatSelectedToolsContext(
        manifests
          .filter((manifest) => toolIds.has(manifest.identifier))
          .map((manifest) => ({
            identifier: manifest.identifier,
            name: manifest.meta?.title ?? manifest.identifier,
            content: manifest.systemRole,
          })),
      );
  const additions = [selectedSkills, selectedTools].filter(Boolean);
  if (!additions.length) return;
  const content = [message.content, ...additions].join('\n\n');
  const result = await update(message.id, { content });
  if (!result.success) throw new Error('Failed to persist selected context');
  message.content = content;
};
