# Publication recovery

**Storage limits require a user-facing recovery handoff.** For report ingest,
atomic evidence upload, or result submission with a file, recognize
`recovery.reason: "storage_quota"`, `failedEvidence[].reason: "storage_quota"`,
or a `storage_block:` error. Do not stop at "upload failed" or "noted in the PR":

- In the final response, state that storage limits blocked publication, distinguish
  locally observed results from uploaded evidence, and report the actual coverage.
  Include the saved acceptance/round links when available; do not invent them for
  an atomic submission that failed before saving a result.
- Give **both recovery options**, in the user's language, using available
  `recovery.cleanupUrl` and `recovery.upgradeUrl` verbatim and following
  `recovery.message`, applying the [Cloud browser-link rule](../SKILL.md#final-handoff-mandatory). Never delete
  user data automatically. Deletion is permanent.
  - Personal scope: **clean up unneeded acceptances** or **upgrade the personal
    plan**. Acceptance cleanup requires selecting "permanently delete all rounds,
    reports, and evidence files"; deleting only a record or evidence association
    does not free storage.
  - Workspace scope (`recovery.scope: "workspace"`): **clean up that workspace's
    files** or **upgrade that workspace's plan**. The cleanup link opens its
    resource library, not an acceptance list; do not invent an acceptance-purge
    checkbox there. Ask its owner/admin for cleanup or billing access. Personal
    cleanup or a personal upgrade does not resolve a workspace limit.
  - If the CLI reports unresolved workspace scope and omits recovery URLs, report
    that limitation and its scope-check instructions. Do not invent links or
    substitute personal pages.
- For an older CLI without recovery metadata, resolve server and scope using
  `lh doctor --offline --json` and `lh workspace current --json`. Personal scope
  uses `/acceptance` and `/settings/plans`. For workspace scope, resolve its slug
  with `lh workspace view --json`, verify the returned ID matches the active
  workspace, and use `/:workspaceSlug/resource` and
  `/:workspaceSlug/settings/plans`; there is no `/:workspaceSlug/acceptance`
  route. If lookup fails, give scope-specific guidance without guessed links.
  Strip URL username/password when constructing display links. For LobeHub Cloud,
  personal cleanup uses `https://lobehub.com/acceptance`; personal plan upgrades use
  `https://lobehub.com/settings/plans`. Workspace resource and plan paths use
  `https://lobehub.com`. Keep self-hosted users on their configured server.
- Preserve local reports, artifacts, and the returned retry instructions. Stop
  blind retries until the user has addressed storage. For a partially ingested
  report, retry only failed artifacts using `failedEvidence[].retryArgs` or
  `retryCommand`, not the whole ingest. For an atomic upload/submission that saved
  nothing, retry that command. Supplementing evidence does not change recorded
  verdicts; read back coverage and do not claim the delivery is complete while
  required evidence is missing.

