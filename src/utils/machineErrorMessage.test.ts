import { describe, expect, it } from 'vitest';

import { isMachineErrorMessage } from './machineErrorMessage';

describe('isMachineErrorMessage', () => {
  it('recognises a Drizzle query dump', () => {
    expect(
      isMachineErrorMessage(
        'Failed query: insert into "messages" ("id") values ($1)\nparams: msg_1',
      ),
    ).toBe(true);
  });

  it('recognises an error carrying its stack trace', () => {
    expect(isMachineErrorMessage('could not delete\n    at Object.<anonymous>')).toBe(true);
  });

  it('leaves a sentence the server wrote on purpose alone', () => {
    expect(isMachineErrorMessage('The folder is not empty')).toBe(false);
    expect(isMachineErrorMessage('could not delete')).toBe(false);
  });
});
