import type { Message } from '../../../../types';
import speakDifferentAgent from './speak-different-agent.json';
import supervisorAfterMultiTasks from './supervisor-after-multi-tasks.json';
import supervisorContentOnly from './supervisor-content-only.json';

export const agentGroup = {
  speakDifferentAgent: speakDifferentAgent as Message[],
  supervisorAfterMultiTasks: supervisorAfterMultiTasks as Message[],
  supervisorContentOnly: supervisorContentOnly as Message[],
};
