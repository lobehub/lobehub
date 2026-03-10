import { renderPlaceholderTemplate } from '@lobechat/context-engine';

import { userPersonaPrompt } from '../../../src/prompts/persona';

interface PersonaPromptVars {
  existingPersona?: string;
  language: string;
  personaNotes?: string;
  recentEvents?: string;
  retrievedMemories?: string;
  username: string;
  userProfile?: string;
}

export default async function generatePrompt({ vars }: { vars: PersonaPromptVars }) {
  const system = renderPlaceholderTemplate(userPersonaPrompt, {
    language: vars.language,
    topK: 10,
    username: vars.username,
  });

  const userSections = [
    '## Existing Persona (baseline)',
    vars.existingPersona || 'No existing persona provided.',
    '## Retrieved Memories / Signals',
    vars.retrievedMemories || 'N/A',
    '## Recent Events or Highlights',
    vars.recentEvents || 'N/A',
    '## User Provided Notes or Requests',
    vars.personaNotes || 'N/A',
    '## Extra Profile Context',
    vars.userProfile || 'N/A',
  ].join('\n\n');

  return [
    { content: system, role: 'system' },
    { content: userSections, role: 'user' },
  ];
}
