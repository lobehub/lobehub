import { CloudSandboxApiName } from '../../types';
import { ExecuteCodeStreaming } from './ExecuteCode';

/**
 * Code Interpreter Streaming Components Registry
 */
export const CloudSandboxStreamings = {
  [CloudSandboxApiName.executeCode]: ExecuteCodeStreaming,
};
