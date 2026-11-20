---
name: desktop-security-update
description: 'Inspect, mark, or revoke vulnerable LobeHub Desktop versions through the existing release workflow and signed R2 security policy. Use for forced security updates across Stable, Canary, Beta, and Nightly.'
---

# Desktop security updates

Operate `.github/workflows/release-desktop-core-ota.yml` using its `security_policy` input. This selects only the policy job; it does not build or publish Core. The policy is global across channels at `<UPDATE_SERVER_URL base>/security-policy.json` in the existing update bucket.

Read [the policy contract](../../../apps/desktop/docs/security-updates.md) for client behavior and delivery limitations. The deterministic operator is `apps/desktop/scripts/desktopSecurityPolicy.mjs`; it shares schema/signature validation with the client. Do not hand-sign JSON, fetch signing secrets locally, replace the whole rule set, or add a workflow.

## Resolve the request

For a mark, determine the installer build channel, platforms, `shell` or `core` target, affected npm SemVer range, fixed full-installer version, and reason. An exact version is a valid range. Do not guess the affected scope from the latest release. If scope is ambiguous, inspect the current policy while asking only for the missing scope. Publish the fixed installer first: the operator checks the public feed and installer availability for every requested platform, including both macOS architectures. Beta uses the Canary installer feed.

A concrete user instruction to mark or revoke a specified scope authorizes that operation. If the user only asks to investigate or prepare, stop after inspection/preview. Do not invent a security restriction while implementing or testing this tooling. Never automatically weaken a range or minimum to make a failed preflight pass.

## Inspect, preview, apply

1. Resolve the actual repository with `gh repo view --json nameWithOwner`. Use the trusted `canary` branch after this workflow change is merged. Check that the remote workflow at the selected ref contains `security_policy` before dispatching; an older workflow could otherwise run an ordinary Core release. Do not dispatch unreviewed code with production signing secrets.
2. Dispatch `{"action":"inspect"}`. Read the downloaded report, including storage revision, rule IDs, `publicRevision`, and `publicError`. Initial absence is revision 0. If an existing policy differs from the public endpoint, resolve that discrepancy before a mutation.
3. Prepare one mark or revoke request with the inspected `expectedRevision`, a concise reason, and `apply:false`. Dispatch it and show the concrete before/after rules and installer checks. A preview performs no writes and uses no private key.
4. If the requested concrete mutation is authorized, dispatch the same request with `apply:true`. If it is not authorized, ask for approval of this prepared change. An earlier explicit mark/revoke instruction is sufficient; do not ask again.
5. Read the report and the exact workflow run. Success requires `status: verified`, with the public URL serving the exact signed policy just written. Report the new revision, affected scope (or revoked rule), and run URL. `no-change` means no publication occurred.

Mark example (replace the illustrative values with the user's scope):

```json
{
  "action": "mark",
  "apply": false,
  "expectedRevision": 7,
  "reason": "Security fix in the full installer",
  "rule": {
    "channel": "stable",
    "platforms": ["darwin", "win32", "linux"],
    "target": "shell",
    "affectedVersions": ">=2.2.0 <2.2.20",
    "minimumInstallerVersion": "2.2.20"
  }
}
```

Revoke request: `{"action":"revoke","expectedRevision":8,"apply":false,"reason":"Restriction withdrawn","ruleId":"<64-character ID from inspect>"}`. Revocation publishes a newer signed revision; never delete the policy or restore an older revision. Marking the same scope updates its minimum; changing its scope creates another rule, so revoke the old rule separately when that is intended.

## Dispatch and collect evidence

Write JSON to a temporary file. Pass it with `gh workflow run --json` via stdin; never interpolate user text into shell commands. Use a fresh UUID as `security_policy_request_id` for **each** dispatch. The workflow title includes it, so unrelated concurrent runs cannot be mistaken for this operation.

```sh
POLICY_REQUEST_ID=$(uuidgen)
jq --arg id "$POLICY_REQUEST_ID" \
  '{channel:"canary",security_policy:tojson,security_policy_request_id:$id}' \
  /tmp/security-policy-request.json > /tmp/security-policy-dispatch.json
gh workflow run release-desktop-core-ota.yml --repo "$POLICY_REPO" --ref canary \
  --json < /tmp/security-policy-dispatch.json
```

Here `channel:canary` satisfies the existing workflow input; the policy request determines the actual affected channels. Locate the run by exact `displayTitle == "Desktop security policy (<UUID>)"`, `event == workflow_dispatch`, and `headBranch == canary` using `gh run list --workflow release-desktop-core-ota.yml --repo "$POLICY_REPO" --json databaseId,displayTitle,event,headBranch,headSha,url,status,conclusion`. Poll for at most two minutes to locate it; do not redispatch just because run discovery is delayed. Watch that run and download `desktop-security-policy-<run-id>` using `gh run download <run-id> --repo "$POLICY_REPO" --name ... --dir <unique-temp-directory>`. Inspect logs if no report was produced.

The publisher checks `expectedRevision`, preserves unrelated rules, signs in Actions, archives the signed revision, conditionally replaces the R2 object using its ETag, and verifies the ordinary public URL. R2 credentials and the OTA signing pair reuse existing workflow secrets.

On a revision/precondition conflict, stop that mutation and inspect again; do not blindly rerun a stale request. On `published-unverified`, the write already succeeded: inspect storage and public delivery, investigate caching, and do not bump revision just to retry. Ambiguous network failures after a write also require inspection. Keep reports/logs as evidence, but never treat a green job, archived object, or preview as proof that clients can fetch the new policy.
