# Canvas through artifact publish

Extend `lh artifact publish <file>` with `--type canvas`. The default remains
ordinary HTML. Remember Canvas type and identity in the existing
`.lobehub/artifacts.json`; subsequent publishes update the bound Canvas and
site, `--new` creates and rebinds, and `--deployment` overrides only this run.
Reject a type change on an existing binding unless explicitly creating a new
artifact. Preserve legacy HTML bindings.

Canvas v1 accepts a self-contained UTF-8 HTML file saved as `index.html`.
Reuse server Canvas validation, storage, quotas, Work registration and runtime
injection. Both content types use the existing Cloud Market deployment service;
do not duplicate its uploader or add a separate `canvas` command. Add
`lh artifact guide canvas` using the existing Canvas guide.

Persist a pending operation before the first mutating request. Bind it to the
authenticated server/user/workspace, input content, title and publication target.
Retries recover the same Canvas and saved version, including a lost save
response. Changed input during a pending operation fails explicitly. Store the
saved result before publishing so publication retries do not add Work versions.
Keep uncertain operations pending until success. A definitive rejected save
(invalid input, stale version, missing target or permission) releases pending
state so the user can fix input or re-read the version on an explicit retry.
Never print success for an
unknown publication result; JSON failures retain the saved identity/version.

Save full Canvas snapshots and retain history. Check the expected current
version inside Work registration's transaction. Publish the saved version,
not whichever version became current between requests. Keep existing Agent and
Web API calls compatible. Enforce write roles, ownership and actual content
validation on the server; never accept client manifests or trusted hashes.

Validate persisted recovery records before reuse. A damaged saved version must
fail without falling back to publishing the current version. Capture the
original binding inside the pending operation so temporary deployment retries
restore precisely the original state. Remember the pending content type when
\--new switches formats, as well as the completed binding's type.

Use existing immutable manifest storage and Work's operation deduplication
before introducing schema changes. Do not delete shared blobs or registrations
on a failed operation. No project-directory input, extra publishing framework,
or independent skill distribution is required.

Verify legacy HTML tests, Canvas creation/update/new, automatic type reuse,
target/scope conflicts, invalid content, unavailable runtime, stale versions,
and retries after save/publish responses are lost. Product acceptance must run
the delivered server and CLI; mock deployment tests alone are insufficient.

## Unified deployment naming and URLs (approved 2026-10-27)

HTML and Canvas pass `--slug` as `requestedSlug` through to Market. Market alone
normalizes and allocates new names: requestedSlug, then the legacy identifier /
title / random fallback. It appends the existing eight-character suffix and
uses the configured subdomain URL template (`<label>.lobe.page` in production).
The synchronous HTML, direct-upload and build allocation paths share this rule.

Existing deployments reuse their stored slug, path and label, including the
existing read fallback for null labels. No schema or stored URL migration.
Existing idempotency records replay the original deployment and address.

Both CLI content types return `publicUrl` as the direct hosted page, `shareUrl`
as the product share page, and the actual `subdomainLabel` when available.
Canvas's legacy `url` server field remains for existing callers. Slug changes
must be part of creation idempotency and local pending-operation fingerprints;
calls without an explicit slug retain the pre-change fingerprint.

A definitive BAD_REQUEST publication response permits correcting only the slug,
reusing the saved Canvas and pinned version. Content and target remain fixed.
Clear that permission before retrying: an unknown outcome locks the corrected
input again to avoid creating another deployment after a lost response.
