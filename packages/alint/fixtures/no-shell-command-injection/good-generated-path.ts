import { exec } from 'node:child_process';

export const inspectGeneratedFile = () => {
  const filePath = `/tmp/generated-${Date.now()}.txt`;
  return exec(`cat '${filePath}'`);
};
