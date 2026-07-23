import type { Message } from '../../../../types';
import mixedGroups from './mixed-groups.json';
import multipleCompressions from './multiple-compressions.json';
import parallelGroup from './parallel-group.json';
import simpleCompression from './simple-compression.json';

export const compression = {
  mixedGroups: mixedGroups as unknown as Message[],
  multipleCompressions: multipleCompressions as Message[],
  parallelGroup: parallelGroup as unknown as Message[],
  simpleCompression: simpleCompression as Message[],
};
