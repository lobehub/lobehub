import { LocalSystemApiName } from '../..';
import { RunCommandStreaming } from './RunCommand';
import { WriteFileStreaming } from './WriteFile';

/**
 * Local System Streaming Components Registry
 *
 * Register each component under both the new short API name and the legacy
 * long name so old DB messages keep rendering after the rename.
 */
export const LocalSystemStreamings = {
  [LocalSystemApiName.runCommand]: RunCommandStreaming,
  [LocalSystemApiName.writeFile]: WriteFileStreaming,
  // Legacy aliases — keep these so historical messages keep rendering
  writeLocalFile: WriteFileStreaming,
};
