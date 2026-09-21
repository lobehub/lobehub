import { AuvApiName } from '../../types';
import { AuvRunCommandInspector } from './runCommand';

/** AUV command headers keyed by the stable builtin API name. */
export const AuvInspectors = {
  [AuvApiName.runCommand]: AuvRunCommandInspector,
};
