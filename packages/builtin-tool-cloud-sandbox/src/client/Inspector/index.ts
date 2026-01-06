import { CloudSandboxApiName } from '../../types';
import { ExecuteCodeInspector } from './ExecuteCode';
import { RunCommandInspector } from './RunCommand';

/**
 * Code Interpreter Inspector Components Registry
 */
export const CloudSandboxInspectors = {
  [CloudSandboxApiName.executeCode]: ExecuteCodeInspector,
  [CloudSandboxApiName.runCommand]: RunCommandInspector,
};
