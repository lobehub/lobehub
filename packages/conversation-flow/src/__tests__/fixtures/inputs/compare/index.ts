import type { Message } from '../../../../types';
import simple from './simple.json';
import withTools from './with-tools.json';

export const compare = {
  simple: simple as Message[],
  withTools: withTools as Message[],
};
