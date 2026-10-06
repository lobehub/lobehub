# Desktop security update policy

Every packaged launch checks `<UPDATE_SERVER_URL base>/security-policy.json` in the background after the main window's first frame. Policy IO does not delay entry, including first installation. This is independent of the OTA channel eligibility, first-launch marker, rollout percentage, and automatic-update preference. Stable installers skip the initial OTA gate; Canary and Beta installers keep it.

The endpoint is independent of versioned Core feeds so one policy can cover existing installers. The client accepts a strict schema, a maximum 1 MiB response, and an Ed25519 signature verified with the packaged OTA public key. The request times out after five seconds.

```json
{
  "kind": "desktop-security-policy",
  "revision": 1,
  "rules": [
    {
      "channel": "stable",
      "platforms": ["darwin", "win32", "linux"],
      "target": "shell",
      "affectedVersions": ">=2.2.0 <2.2.20",
      "minimumInstallerVersion": "2.2.20"
    },
    {
      "channel": "canary",
      "platforms": ["darwin"],
      "target": "core",
      "affectedVersions": "2.2.20-canary.3",
      "minimumInstallerVersion": "2.2.20-canary.4"
    }
  ],
  "schemaVersion": 1,
  "signature": "<base64 Ed25519 signature>"
}
```

Sign the canonical JSON of all fields except `signature`, using the shared recursive sorted-key canonicalization in `src/common/signedJson.ts`. The schema lives in `src/common/securityPolicy.ts`; both the client and publisher consume these modules. `kind` separates the policy from an OTA manifest. Increment `revision` for every policy change, including revocation; an empty `rules` array with a newer revision clears restrictions. Publish the complete rule set each time. Lower or equal revisions cannot replace a verified local policy.

`channel` refers to the installer build channel, not a user-selected update preference. `target: shell` matches the installed full-package version. `target: core` matches the active Core version. `affectedVersions` uses npm SemVer ranges with prereleases included; an exact version is also valid. Rules are limited to the listed platforms. Overlapping rules all apply.

After a background check finds a matching restriction, the shell opens its required-update window, disables existing and newly created business windows, and offers Retry or Quit on failure. A retry that receives a newer policy revoking the restriction closes the update window and restores the prior enabled state of business windows. It fetches a full installer from its build channel (Beta uses the Canary installer feed), using Sparkle on macOS and electron-updater elsewhere. The available installer must meet every matched rule's minimum version and must not match any affected range for this channel/platform. Publish a usable fixed installer before publishing a restriction. A full installer is expected to ship a Core at that same version; the next startup evaluates the actual installed Shell and Core again.

Verified policies are persisted atomically in `security-update-policy.json` under userData. A failed request, invalid signature, missing endpoint, or older response retains the previous verified policy. If refresh fails offline, a cached matching restriction still triggers the required-update window after entry. Without any verified policy, unavailable policy service does not block ordinary startup. This is operational update enforcement, not protection against a user who deliberately modifies their local installation/cache.

## Publishing and operator skill

Use the repository [desktop-security-update skill](../../../.agents/skills/desktop-security-update/SKILL.md) to inspect, mark, preview, apply, and revoke restrictions. For example: “Mark Stable Windows shell versions >=2.2.0 <2.2.20 as vulnerable, requiring installer 2.2.20, because of the confirmed security fix.” Scope and release numbers must come from the actual incident.

The existing `release-desktop-core-ota.yml` workflow accepts an optional `security_policy` JSON input. When set, only the policy job runs; ordinary Core build/publish jobs are skipped. Existing manual Core releases and `workflow_call` callers retain their behavior. The isolated publisher installs from the committed manifest and lockfile in `scripts/security-policy-runtime/` using `npm ci --ignore-scripts`; dependency changes must update both files together. Policy operations serialize globally across channels. `security_policy_request_id` appears in the run title for unambiguous run discovery.

`apps/desktop/scripts/desktopSecurityPolicy.mjs` implements three request types:

- `inspect`: return authoritative storage revision and rule IDs, and compare public delivery.
- `mark`: upsert one rule, preserving unrelated rules. Requires `expectedRevision`, `reason`, and `rule`. A rule's ID hashes its channel, sorted platform set, target, and affected range; updating its repair minimum keeps the ID.
- `revoke`: remove one inspected `ruleId`, preserving unrelated rules. Requires `expectedRevision` and `reason`.

Mutations default to `apply:false`. Preview checks the public repair feeds and installer availability without writing. `apply:true` additionally signs with `RENDERER_OTA_PRIVATE_KEY`, checks it against `RENDERER_OTA_PUBLIC_KEY`, archives the signed policy under `security-policy-history/<revision>-<hash>.json`, and conditionally writes `security-policy.json` using the prior ETag (or `If-None-Match: *` on first publication). The request must match the authoritative revision. Repeating an identical mark is a no-op.

The policy uses the existing `UPDATE_SERVER_URL`, `UPDATE_S3_ENDPOINT`, `UPDATE_S3_REGION`, `UPDATE_S3_BUCKET`, `UPDATE_AWS_ACCESS_KEY_ID`, and `UPDATE_AWS_SECRET_ACCESS_KEY` secrets. Actions validates and normalizes the request without credentials, then routes it to inspection/preview or publication. Only the publication step for a validated `apply:true` request receives the signing private key; inspection and preview processes never receive it. Each run uploads a JSON report containing before/after rules, reason, actor, installer checks, publication status, and run URL. Signed policy history remains in the bucket; operation reports are retained for 90 days.

Success requires fetching and verifying the exact signed object through the ordinary public policy URL. A stale cache or failed readback fails the run after the write and leaves `published-unverified` in its report. Inspect before retrying: do not blindly republish, delete the object, or restore an older revision. Configure the public endpoint to respect the object's `Cache-Control: no-store, max-age=0`; bypass any CDN rule that forcibly caches this path, including cached 404s from before first publication.

Installer preflight checks the candidate version against all rules for the same channel/platform, signed Sparkle enclosure metadata on both macOS architectures, hashed Windows/Linux installer entries, and public HEAD availability. It does not replace platform signing, installation, or product acceptance. The client rechecks its installed Shell/Core on its next startup.

## Current delivery boundary

- Requires a new full installer containing this startup gate; older clients cannot learn this behavior through a policy file alone.
- Checks start in the background after the first frame on each launch; a matching result immediately opens the required-update window. No periodic policy polling or push subscription is included, so a later publication is picked up on a subsequent launch or a Retry in the required-update window.
- Merge the publisher/workflow to the trusted release branch before invoking the production skill. Implementing or testing the tooling does not publish a real restriction.
- First-launch Core OTA continues to use the existing signed feed and offline-first behavior, independently of the background security check.
