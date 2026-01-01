import { LocalSystemApiName } from '../..';
import { RunCommandStreaming } from './RunCommand';

/**
 * Local System Streaming Components Registry
 */
export const LocalSystemStreamings = {
  [LocalSystemApiName.runCommand]: RunCommandStreaming,
};
