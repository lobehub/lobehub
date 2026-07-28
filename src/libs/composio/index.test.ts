import { ComposioConnectedAccountNotFoundError, ComposioToolExecutionError } from '@composio/core';
import { describe, expect, it } from 'vitest';

import { isComposioConnectedAccountNotFoundError } from './index';

describe('isComposioConnectedAccountNotFoundError', () => {
  /** @example A normalized SDK error is recognized by its concrete class. */
  it('recognizes the Composio connected-account error class', () => {
    expect(
      isComposioConnectedAccountNotFoundError(new ComposioConnectedAccountNotFoundError()),
    ).toBe(true);
  });

  /** @example connectedAccounts.get may expose the generated client's HTTP status directly. */
  it('recognizes a direct HTTP 404 from the connected-account API', () => {
    expect(isComposioConnectedAccountNotFoundError({ status: 404 })).toBe(true);
  });

  /** @example Unrelated wrapped errors are not recursively interpreted by this boundary. */
  it('does not classify unrelated or causally nested errors', () => {
    expect(isComposioConnectedAccountNotFoundError({ status: 500 })).toBe(false);
    expect(
      isComposioConnectedAccountNotFoundError(
        new ComposioToolExecutionError('tool failed', { cause: { status: 404 } }),
      ),
    ).toBe(false);
  });
});
