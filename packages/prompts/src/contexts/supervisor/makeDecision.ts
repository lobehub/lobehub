import { ChatCompletionTool, ChatStreamPayload, UIChatMessage } from '@lobechat/types';

import { groupChatPrompts, groupSupervisorPrompts } from '../../prompts';
import { SupervisorToolName, SupervisorTools } from './tools';

interface SupervisorTodoItem {
  // optional assigned owner (agent id or name)
  assignee?: string;
  content: string;
  finished: boolean;
}

interface AgentItem {
  id: string;
  title?: string | null;
}
export interface SupervisorContext {
  allowDM?: boolean;
  availableAgents: AgentItem[];
  messages: UIChatMessage[];
  // Group scene controls which tools are exposed (e.g., todos only in 'productive')
  scene?: 'casual' | 'productive';
  systemPrompt?: string;
  todoList?: SupervisorTodoItem[];
  userName?: string;
}

export const contextSupervisorMakeDecision = ({
  allowDM,
  scene,
  systemPrompt,
  availableAgents,
  todoList,
  userName,
  messages,
}: SupervisorContext) => {
  const conversationHistory = groupSupervisorPrompts(messages);
  const prompt = groupChatPrompts.buildSupervisorPrompt({
    allowDM,
    availableAgents: availableAgents.filter((agent) => agent.id),
    conversationHistory,
    scene,
    systemPrompt,
    todoList,
    userName,
  });

  const tools = SupervisorTools.filter((tool) => {
    if (tool.name === SupervisorToolName.trigger_agent_dm) {
      return allowDM;
    }

    if ([SupervisorToolName.finish_todo, SupervisorToolName.create_todo].includes(tool.name)) {
      return scene === 'productive';
    }

    return true;
  }).map<ChatCompletionTool>((tool) => ({
    function: tool,
    type: 'function',
  }));

  return {
    messages: [{ content: prompt, role: 'user' }],
    temperature: 0.3,
    tools,
  } satisfies Partial<ChatStreamPayload>;
};
