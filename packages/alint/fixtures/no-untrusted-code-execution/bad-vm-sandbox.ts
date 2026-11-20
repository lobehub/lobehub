import vm from 'node:vm';

export const evaluateRequest = (input: { code: string }) => {
  // alint-expect
  return vm.runInNewContext(input.code, {});
};
