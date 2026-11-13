import { requireExecutionApproval } from './executionPolicy';
import { remoteSandbox } from './sandbox';

export const runModelCode = async (input: { modelGeneratedCode: string }) => {
  await requireExecutionApproval(input.modelGeneratedCode);
  return remoteSandbox.execute({ code: input.modelGeneratedCode, network: false });
};
