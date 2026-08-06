---
name: aico-ship
description: >-
  Aico dual-track shipping: GitHub issues (English) + Plane work items (Persian),
  cross-links, finish-job closeout, and PRs to canary with Fixes #n. Use when
  creating an issue, opening a PR, finishing a shippable job, or the user asks
  for Plane/GitHub workflow, ship, submit, or closeout. Triggers on 'issue',
  'create issue', 'pr', 'create pr', 'ship', 'submit', 'workflow', 'plane',
  'AICO-', 'finish', 'closeout', 'ذخیره', 'ببند'.
---

# Aico ship (Plane + GitHub + PR)

Aico-owned overlay. **Do not edit** upstream LobeHub skills under `.agents/skills/`
(e.g. `pr`, `linear`) for Aico process — put overrides here instead.

## Ownership split

| Concern                                                         | Use                             |
| --------------------------------------------------------------- | ------------------------------- |
| Git branch / commit / push / `gh pr create` mechanics           | `pr` skill (untouched upstream) |
| Plane MCP tools, states, Persian comment format                 | `plane` skill                   |
| Dual trackers, no-search policy, finish-job, Aico PR body rules | **this skill** (`aico-ship`)    |
| Sync `upstream/canary` while keeping Aico fork changes          | `aico-upstream-sync`            |

When `pr` says to search GitHub issues or link Linear (`LOBE-xxx`), **ignore that for Aico**. This fork tracks work with Plane + GitHub issues created from Cursor.

## Language

- **Plane** titles, descriptions, comments → **Persian (فارسی)**. Paths, `AICO-xx`, code, commands, errors stay English inside Persian text.
- **GitHub** issues, PR titles/bodies, commits, review comments → **English**.

## No duplicate search

Do **not** run Plane `search_work_items` or `gh issue list --search` before creating trackers. Agent work issues are expected to be created from Cursor in this session.

Only reuse a tracker if this chat (or the user) already supplied a specific `#n` or `AICO-xx`.

**Do not create a second GitHub issue or Plane item** when this chat already has one for the same work (e.g. user says “issue 94” and you were about to open #95). Reuse every `#n` / `AICO-xx` already in the thread.

## Creating an “issue”

Create **both**:

1. GitHub issue (EN) — `gh issue create`
2. Plane work item (FA) — default Aico project unless named otherwise (`plane` skill defaults)

Cross-link:

- Plane comment or `create_work_item_link` → GitHub issue URL
- GitHub issue body → Plane browse URL / `AICO-xx`

## Finish-job closeout

When implementation is done (or the user asks to ship / open a PR / “do the workflow”), run closeout — do not leave shippable code only as local uncommitted changes without this path.

### Auto-run vs suggest

**Run automatically** when any of:

- User asked for issue / PR / Plane / workflow / ship / submit
- Change is a real product bug fix or feature meant for `canary`
- This chat already has Plane/`AICO-xx` and/or a GitHub `#n` for the work

**Suggest once** when:

- Scope is ambiguous and they never mentioned shipping
- Only docs / agent rules / local tooling changed
- Unrelated diffs are mixed — ask which slice to track

**Skip** when: pure Q\&A; user forbade commit/push/PR/trackers; trackers + PR already exist and are current.

### Checklist

1. If this chat has no `#n` / `AICO-xx`, create GitHub (EN) + Plane (FA) and cross-link — **no** prior search
2. Follow the `pr` skill for branch (off `canary` if needed), gitmoji commit, push, and `gh pr create --base canary`
3. PR body **must** include `Fixes #n` (not only `Related to`) for **every** GitHub issue this PR finishes, and Plane `AICO-xx` / browse URL for each related work item
4. Plane: state → **Testing** (review stand-in; not Done until merge) + Persian completion comment with PR URL (`plane` skill format)

## PR body (Aico)

GitHub auto-closes issues on merge when the PR body uses closing keywords (`Fixes`, `Closes`, or `Resolves`) — **one issue per line**. `Related to #n` does **not** close.

```markdown
#### 🔗 Related Issue

Fixes #123
Fixes #124

Plane: [AICO-12](https://plane.panafor.com/panaforai/browse/AICO-12)
Plane: [AICO-13](https://plane.panafor.com/panaforai/browse/AICO-13)
```

### Multiple issues in one PR

When one PR finishes several trackers (same fix, duplicate issues, or a bundled closeout):

1. Collect **all** `#n` / `AICO-xx` already in this chat — do not ship with only the newest duplicate.
2. Put **each** finished GitHub issue on its own `Fixes #n` line in the PR body (GitHub merges the close on PR merge).
3. Link every related Plane item in the PR body; move each to **Testing** and comment with the PR URL.
4. If duplicate GitHub issues exist for the same work, include **all** of them in `Fixes #n` so merge closes every duplicate — do not leave siblings open like #94 when #95 was the only `Fixes` line.

Example (this session’s locale work should have been):

```markdown
Fixes #94
Fixes #95
```

## After merge

Mark Plane **Done** only after merge (or when the user says no review is needed).
