import { describe, expect, it } from 'vitest';

import { accountLines } from './accountLines';

describe('accountLines', () => {
  it('names a labelled account by its label and keeps the email as a second line', () => {
    expect(
      accountLines({
        email: 'alice@example.com',
        externalAccountId: 'ext',
        id: 'acc',
        label: 'Alice Max',
      }),
    ).toEqual({ email: 'alice@example.com', name: 'Alice Max' });
  });

  it('names an unlabelled account by its email without repeating it', () => {
    expect(
      accountLines({
        email: 'alice@example.com',
        externalAccountId: 'ext',
        id: 'acc',
        label: null,
      }),
    ).toEqual({ email: undefined, name: 'alice@example.com' });
  });

  it('falls back to the account id when the provider gave no id either', () => {
    expect(accountLines({ email: null, externalAccountId: null, id: 'acc', label: null })).toEqual({
      email: undefined,
      name: 'acc',
    });
  });

  it('falls back to the provider id when there is neither label nor email', () => {
    expect(accountLines({ email: null, externalAccountId: 'ext', id: 'acc', label: null })).toEqual(
      {
        email: undefined,
        name: 'ext',
      },
    );
  });
});
