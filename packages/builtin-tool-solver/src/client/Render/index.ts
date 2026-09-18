import type { BuiltinRender } from '@lobechat/types';

import { SolverApiName } from '../../types';
import SolveRender from './Solve';
import VerifyRender from './Verify';

export const SolverRenders: Record<string, BuiltinRender> = {
  [SolverApiName.solve]: SolveRender as BuiltinRender,
  [SolverApiName.verify]: VerifyRender as BuiltinRender,
};

export { default as SolveRender } from './Solve';
export { default as VerifyRender } from './Verify';
