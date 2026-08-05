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
3. PR body **must** include `Fixes #n` (not only `Related to`) and Plane `AICO-xx` / browse URL
4. Plane: state → **Testing** (review stand-in; not Done until merge) + Persian completion comment with PR URL (`plane` skill format)

## PR body (Aico)

```markdown
#### 🔗 Related Issue

Fixes #123

Plane: [AICO-xx](https://plane.panafor.com/panaforai/browse/AICO-xx)
```

Multiple finished GitHub issues → one `Fixes #n` line each.

## After merge

Mark Plane **Done** only after merge (or when the user says no review is needed).
