import { LocalSystemApiName } from '../..';
import { RunCommandStreaming } from './RunCommand';
import { WriteFileStreaming } from './WriteFile';

/**
 * Local System Streaming Components Registry
 */
export const LocalSystemStreamings = {
  [LocalSystemApiName.runCommand]: RunCommandStreaming,
  [LocalSystemApiName.writeLocalFile]: WriteFileStreaming,
};
