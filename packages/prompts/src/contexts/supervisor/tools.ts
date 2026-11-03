import type { LobeUniformTool } from '@lobechat/types';

export const SupervisorToolName = {
  create_todo: 'create_todo',
  finish_todo: 'finish_todo',
  trigger_agent: 'trigger_agent',
  trigger_agent_dm: 'trigger_agent_dm',
  wait_for_user_input: 'wait_for_user_input',
};

export const SupervisorTools: LobeUniformTool[] = [
  {
    description: 'Trigger an agent to speak (group message).',
    name: SupervisorToolName.trigger_agent,
    parameters: {
      properties: {
        id: {
          description: 'The agent id to trigger.',
          type: 'string',
        },
        instruction: {
          description:
            'The instruction or message for the agent. No longer than 10 words. Always use English.',
          type: 'string',
        },
      },
      required: ['id', 'instruction'],
      type: 'object',
    },
  },
  {
    description:
      'Wait for user input. Use this when the conversation history looks likes fine for now, or agents are waiting for user input.',
    name: SupervisorToolName.wait_for_user_input,
    parameters: {
      properties: {
        reason: {
          description: 'Optional reason for pausing the conversation.',
          type: 'string',
        },
      },
      required: [],
      type: 'object',
    },
  },

  {
    description: 'Trigger an agent to DM another agent or user.',
    name: SupervisorToolName.trigger_agent_dm,
    parameters: {
      additionalProperties: false,
      properties: {
        id: {
          description: 'The agent id to trigger.',
          type: 'string',
        },
        instruction: {
          type: 'string',
        },
        target: {
          description: 'The target agent id. Only used when need DM.',
          type: 'string',
        },
      },
      required: ['instruction', 'id', 'target'],
      type: 'object',
    },
  },
  {
    description: 'Create a new todo item',
    name: SupervisorToolName.create_todo,
    parameters: {
      additionalProperties: false,
      properties: {
        assignee: {
          description: 'Who will do the todo. Can be agent id or empty.',
          type: 'string',
        },
        content: {
          description: 'The todo content or description.',
          type: 'string',
        },
      },
      required: ['content', 'assignee'],
      type: 'object',
    },
  },
  {
    description: 'Finish a todo by index or all todos',
    name: SupervisorToolName.finish_todo,
    parameters: {
      additionalProperties: false,
      properties: {
        index: {
          type: 'number',
        },
      },
      required: ['index'],
      type: 'object',
    },
  },
];
