import type { BuiltinInspector } from '@lobechat/types';

import { SolverApiName } from '../../types';
import SolveInspector from './Solve';
import VerifyInspector from './Verify';

export const SolverInspectors: Record<string, BuiltinInspector> = {
  [SolverApiName.solve]: SolveInspector as BuiltinInspector,
  [SolverApiName.verify]: VerifyInspector as BuiltinInspector,
};

export { default as SolveInspector } from './Solve';
export { default as VerifyInspector } from './Verify';
