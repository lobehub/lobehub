# Home First Paint and Persistent Caches

Home and its sidebar must prioritize a stable first paint. Avoid showing a default
portrait, initials avatar, or hidden project section and then replacing it when user
data arrives. For repeat visits, consider persisting the data that determines those
elements: image URLs and selected configuration, not just the image bytes cached by
the browser.

## Choose the Existing Persistence Path

- Inspect the existing store, SWR key, persistence tier, and hydration consumer before
  adding storage. An in-memory SWR hit does not survive a full reload; a persisted
  entry does not help if the UI's Zustand state only receives network success events.
- Reuse `src/libs/swr/localStorageProvider.ts` and its `CACHE_TIERS` for suitable
  query results. Builtin agent identity/configuration and project lists use its
  asynchronous IndexedDB tier; the localStorage tier restores synchronously.
  Restore cached results into the state consumed by the UI, then revalidate through
  the existing SWR hook.
- For a small subset needed before a larger response arrives, reuse
  `LocalStorageQueryProjectionStorage` from `src/libs/queryProjectionStorage`.
  Keep field selection and lifecycle rules in the owning domain; do not create
  another storage framework or duplicate the same data across caches without a
  demonstrated need.
- Synchronous local restoration may run during pre-paint initialization, as in
  the `useLayoutEffect` hydration path in `src/store/project/store.ts`. This is not
  permission to fetch APIs in effects. IndexedDB hydration is asynchronous: account for its readiness instead
  of assuming persisted data is immediately available. With no usable cache, reserve
  stable space or show a bounded loading state until the relevant data resolves.
  Do not block the entire home on unrelated queries or add arbitrary delays.

## User Display Snapshot Reference

`src/store/user/displaySnapshot.ts` is the domain adapter for the user's avatar URL
and preference. It reuses `LocalStorageQueryProjectionStorage`; it is not a second
cache engine. `src/layout/AuthProvider/BetterAuth/UserUpdater.tsx` reads it after the
session identifies the exact user, before painting that user's initialized shell.
The authoritative user-state response still refreshes the values afterward.

- Keep the snapshot limited to validated display fields. Do not persist the whole
  `user:initState` response to fix flicker: it also contains entitlement and onboarding
  state. Cached preferences may shape presentation, but must not establish permission
  or authentication.
- Merge partial avatar/preference updates so updating one does not erase the other.
  On successful sign-out, clear that user's snapshot. Never restore a last-used
  user's private display data before confirming the current identity.
- Use this adapter for user display data; builtin agent artwork and project data
  belong to their existing domain caches. A new domain does not automatically need
  its own `displaySnapshot.ts`.

## Lifecycle and Verification

Reuse the SWR provider's existing user/workspace partitioning and identity trust
checks; do not implement another partition manager. Domain projections must supply
their explicit scope. Ensure in-memory keys and hydration consumers also respect
scope, since persistence partitioning alone cannot guard late callbacks.
Capture mutation scope and reject stale responses after a scope switch before they
update visible state or caches. Keep accepted writes reflected in the cache used on
the next reload, and preserve usable content during background refresh failures.

For changes affecting home first paint or persisted display data, select relevant
checks: a full reload with persisted data and delayed APIs, a missing/corrupt cache,
delayed asynchronous hydration, save-then-reload, sign-out, and account/workspace
switches. For visible transitions, inspect frames or video, not only the final
screenshot. Assert no default-to-custom flash, collapsing sections, cross-scope data, or indefinite loading on failure.
