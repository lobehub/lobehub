import type { GroupMemberSummary } from './types';

/**
 * Model-facing text for `listGroupMembers`, shared by the server and client
 * runtimes. Group-built members are virtual agents, so `searchAgent` never
 * returns them — this list is where the model reads back the ids that
 * `updateAgentPrompt` / `updateConfig` / `removeAgent` require.
 */
export const formatGroupMembers = (members: GroupMemberSummary[]): string => {
  if (members.length === 0) return 'This group has no members.';

  const lines = members.map((member, index) => {
    const name = member.name?.trim();
    const label = name && name !== member.title ? `${name} [title: ${member.title}]` : member.title;
    const role = member.isSupervisor ? ', supervisor' : '';
    const description = member.description ? ` - ${member.description}` : '';

    return `${index + 1}. ${label} (ID: ${member.id}${role})${description}`;
  });

  return `This group has ${members.length} member${members.length > 1 ? 's' : ''}:\n${lines.join('\n')}`;
};
