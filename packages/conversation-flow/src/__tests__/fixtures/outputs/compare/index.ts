import type { SerializedParseResult } from '../..';
import simple from './simple.json';
import withTools from './with-tools.json';

export const compare = {
  simple: simple as unknown as SerializedParseResult,
  withTools: withTools as unknown as SerializedParseResult,
};
