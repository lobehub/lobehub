import { CodeInterpreterApiName } from '../../types';
import { ExecuteCodeInspector } from './ExecuteCode';
import { RunCommandInspector } from './RunCommand';

/**
 * Code Interpreter Inspector Components Registry
 */
export const CodeInterpreterInspectors = {
  [CodeInterpreterApiName.executeCode]: ExecuteCodeInspector,
  [CodeInterpreterApiName.runCommand]: RunCommandInspector,
};
