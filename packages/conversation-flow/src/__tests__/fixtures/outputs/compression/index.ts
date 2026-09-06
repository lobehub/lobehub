import type { SerializedParseResult } from '../..';
import mixedGroups from './mixed-groups.json';
import multipleCompressions from './multiple-compressions.json';
import parallelGroup from './parallel-group.json';
import simpleCompression from './simple-compression.json';

export const compression = {
  mixedGroups: mixedGroups as unknown as SerializedParseResult,
  multipleCompressions: multipleCompressions as unknown as SerializedParseResult,
  parallelGroup: parallelGroup as unknown as SerializedParseResult,
  simpleCompression: simpleCompression as unknown as SerializedParseResult,
};
