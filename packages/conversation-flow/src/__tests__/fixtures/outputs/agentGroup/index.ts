import type { SerializedParseResult } from '../..';
import speakDifferentAgent from './speak-different-agent.json';
import supervisorAfterMultiTasks from './supervisor-after-multi-tasks.json';
import supervisorContentOnly from './supervisor-content-only.json';

export const agentGroup = {
  speakDifferentAgent: speakDifferentAgent as unknown as SerializedParseResult,
  supervisorAfterMultiTasks: supervisorAfterMultiTasks as unknown as SerializedParseResult,
  supervisorContentOnly: supervisorContentOnly as unknown as SerializedParseResult,
};
