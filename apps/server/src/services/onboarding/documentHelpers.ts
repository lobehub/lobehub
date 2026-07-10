import { SOUL_DOCUMENT } from '@lobechat/agent-templates';
import type { UserAgentOnboarding } from '@lobechat/types';

interface AgentIdentityInput {
  emoji: string;
  name: string;
  nature: string;
  vibe: string;
}

const appendSection = (sections: string[], title: string, content?: string) => {
  if (!content) return;

  sections.push(`## ${title}\n\n${content}`);
};

export const buildIdentityDocument = (identity: AgentIdentityInput): string => {
  const lines = [
    '# IDENTITY.md - Who Am I?',
    '',
    `- **Name:** ${identity.name}`,
    `- **Creature:** ${identity.nature}`,
    `- **Vibe:** ${identity.vibe}`,
    `- **Emoji:** ${identity.emoji}`,
  ];

  return lines.join('\n');
};

export const buildSoulDocument = (
  state: Pick<UserAgentOnboarding, 'profile' | 'version'>,
): string => {
  const profile = state.profile;

  if (!profile) return SOUL_DOCUMENT.content;

  const sections: string[] = [];

  appendSection(sections, 'About My Human', profile.identity?.summary);
  appendSection(sections, 'How We Work Together', profile.workStyle?.summary);

  if (profile.workContext?.summary) {
    const listItems: string[] = [];

    if (profile.workContext.activeProjects?.length) {
      listItems.push(`- **Active Projects:** ${profile.workContext.activeProjects.join(', ')}`);
    }

    if (profile.workContext.interests?.length) {
      listItems.push(`- **Interests:** ${profile.workContext.interests.join(', ')}`);
    }

    if (profile.workContext.tools?.length) {
      listItems.push(`- **Tools:** ${profile.workContext.tools.join(', ')}`);
    }

    sections.push(
      [
        '## Current Context',
        '',
        profile.workContext.summary,
        ...(listItems.length > 0 ? ['', ...listItems] : []),
      ].join('\n'),
    );
  }

  appendSection(sections, 'Where I Can Help Most', profile.painPoints?.summary);

  if (sections.length === 0) return SOUL_DOCUMENT.content;

  return [SOUL_DOCUMENT.content, '---', sections.join('\n\n')].join('\n\n');
};
