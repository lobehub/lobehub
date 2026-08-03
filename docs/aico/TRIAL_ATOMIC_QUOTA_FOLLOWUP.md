# Follow-up: Atomic Trial Quota Reservation

**Status:** Deferred from final remediation wave. Trial remains **disabled in production**.

## Problem

`maxRequests` checked then incremented around the chat path is TOCTOU under concurrency.

## Required design

1. **Reserve** one request unit in the same DB transaction that authorizes Trial execution, using:
   `UPDATE user_trials SET request_count = request_count + 1 WHERE … AND (max IS NULL OR request_count < max) RETURNING …`
2. If no row returned → `TRIAL_REQUEST_LIMIT` fail closed **before** calling OpenRouter.
3. If OpenRouter call never starts (auth/policy failure before network) → compensating decrement.
4. If streaming/output begins → reservation is consumed; user abort does not refund.
5. Keep UNIQUE phone fingerprint + abuse blocklist unchanged.

## Exit criteria

- Concurrent N+1 activations of the last request slot: exactly one succeeds.
- Production may set `AICO_ALLOW_TRIAL=1` only after this ships with regression tests.
