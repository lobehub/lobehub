import { ComposioConnectedAccountNotFoundError, ComposioToolExecutionError } from '@composio/core';
import { describe, expect, it } from 'vitest';

import {
  isComposioConnectedAccountLookupNotFoundError,
  isComposioConnectedAccountNotFoundError,
} from './index';

describe('isComposioConnectedAccountNotFoundError', () => {
  /** @example A normalized SDK error is recognized by its concrete class. */
  it('recognizes the Composio connected-account error class', () => {
    expect(
      isComposioConnectedAccountNotFoundError(new ComposioConnectedAccountNotFoundError()),
    ).toBe(true);
  });

  /** @example A raw tool HTTP 404 is not sufficient proof that the account is missing. */
  it('does not classify a direct HTTP 404 outside an account lookup', () => {
    // ROOT CAUSE:
    //
    // A valid tool can return HTTP 404 for a missing provider resource.
    // Treating every direct 404 as an account failure disables a healthy connector.
    //
    // Before: the shared predicate returned true for any direct status 404.
    // We fixed this by reserving raw HTTP matching for the account lookup boundary.
    expect(isComposioConnectedAccountNotFoundError({ status: 404 })).toBe(false);
  });

  /** @example connectedAccounts.get may expose the generated client's HTTP status directly. */
  it('recognizes a direct HTTP 404 at the connected-account lookup boundary', () => {
    expect(isComposioConnectedAccountLookupNotFoundError({ status: 404 })).toBe(true);
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
