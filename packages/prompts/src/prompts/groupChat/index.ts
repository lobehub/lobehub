import type { UIChatMessage } from '@lobechat/types';

export interface GroupMemberInfo {
  id: string;
  title: string;
}

export interface SupervisorTodoItem {
  assignee?: string;
  content: string;
  finished: boolean;
}

const buildGroupMembersTag = (members: GroupMemberInfo[]): string => {
  if (!members || members.length === 0) return '';
  const memberList = members
    .map((member) => `  <member id="${member.id}" title="${member.title}" />`)
    .join('\n');
  return `<group_members>\n${memberList}\n</group_members>`;
};

export const buildGroupChatSystemPrompt = ({
  baseSystemRole = '',
  agentId,
  groupMembers,
  targetId,
  instruction,
}: {
  agentId: string;
  baseSystemRole?: string;
  groupMembers: GroupMemberInfo[];
  instruction?: string;
  messages: UIChatMessage[];
  targetId?: string;
}): string => {
  const membersTag = buildGroupMembersTag(groupMembers);

  const agentTitle = groupMembers.find((m) => m.id === agentId)?.title || 'Agent';

  const guidelines = [
    `Stay in character as ${agentId} (${agentTitle})`,
    'Be concise and natural, behave like a real person',
    "The group supervisor will decide whether to send it privately or publicly, so you just need to say the actuall content, even it's a DM to a specific member. Do not pretend you've sent it.",
    "Be collaborative and build upon others' responses when appropriate",
    'Keep your responses concise and relevant to the ongoing discussion',
  ];

  const guidelinesSection = ['Guidelines:', '', ...guidelines.map((line) => `- ${line}`)].join(
    '\n',
  );

  const sections = [baseSystemRole, guidelinesSection];

  if (membersTag) sections.push(membersTag);

  // Add response instruction at the end
  const targetText = targetId ? targetId : 'the group publicly';
  const instructionText = instruction ? `SUPERVISOR INSTRUCTION: ${instruction}` : '';
  const responseInstruction =
    `Now it's your turn to respond. ${instructionText} You are sending message to ${targetText}. Please respond as this agent would, considering the full conversation history provided above. Directly return the message content, no other text. You do not need add author name or anything else.`.trim();

  sections.push(responseInstruction);

  return sections.filter(Boolean).join('\n\n').trim();
};

export interface SupervisorPromptParams {
  allowDM?: boolean;
  availableAgents: Array<{ id: string; title?: string | null }>;
  conversationHistory: string;
  scene?: 'casual' | 'productive';
  systemPrompt?: string;
  todoList?: SupervisorTodoItem[];
  userName?: string;
}

const buildTodoListTag = (todoList?: SupervisorTodoItem[]): string => {
  if (!todoList || todoList.length === 0) return '';

  const serialized = JSON.stringify(todoList && todoList.length > 0 ? todoList : [], null, 2);
  return `<todo_list>\n${serialized}\n</todo_list>`;
};

export const buildSupervisorPrompt = ({
  allowDM = true,
  scene = 'productive',
  availableAgents,
  conversationHistory,
  todoList,
  systemPrompt,
  userName,
}: SupervisorPromptParams): string => {
  const members = [
    {
      id: 'user',
      name: userName || 'User',
      role: 'user',
    },
    // Then include all agents
    ...availableAgents.map((agent) => ({
      id: agent.id,
      name: agent.title || agent.id,
      role: 'assistant',
    })),
  ];

  const memberList = members
    .map((member) => `  <member id="${member.id}" name="${member.name}" />`)
    .join('\n');

  const todoListTag = scene === 'productive' ? buildTodoListTag(todoList) : '';

  // Build rules and examples for DM usage
  const dmRules = allowDM
    ? `- To send a private message, use "trigger_agent_dm" and set "target" to the recipient agent id or "user".
- Use public messages by default; choose DM only when the message MUST be private.`
    : '';

  const prompt = `
You are a conversation supervisor for a group chat with multiple AI agents. Your role is to orchestrate a group of agents to make user feel natural and interactive.

<group_role>
${systemPrompt || ''}
</group_role>

<group_members>
${memberList}
</group_members>

<conversation_history>
${conversationHistory}
</conversation_history>

${todoListTag}

RULES:

- Do not forcing user to respond, only ask for information for one time before you get the information you need.
- Make the group conversation feels like a real conversation.

WHEN ASKING AGENTS TO SPEAK:

- Only reference agents from the member list. Never invent new IDs.
- Do not excessivly gathering information from user, you should only ask for information when it's necessary.
- If need many information from user, make single agent to ask for all.
${dmRules}

${
  scene === 'productive'
    ? `WHEN GENERATING TODOS:

- Only use Todo for complex tasks.
- Break down the main objective into logical, sequential tasks.
- Be concise and to the point. Each todo should no longer than 10 words. Do not create more than 5 todos.
- Match user's message language.
- By only assigning todo will not tirgger agent response you still need to use trigger tool if needed.
- Keep todo items synchronized with the context. Finish or create todos as progress changes.`
    : ''
}
`;

  return prompt.trim();
};

export const groupChatPrompts = {
  buildGroupChatSystemPrompt,
  buildSupervisorPrompt,
};
