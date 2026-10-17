---
name: store-data-structures
description: 'Explicit compatibility entry for Zustand data-shape guidance.'
disable-model-invocation: true
user-invocable: true
---

# Store Data Structures

Read [Zustand data structures](../zustand/references/data-structures.md) for
list/detail types, maps, reducers and shared type sources. The `zustand` skill
is the automatic entry for store work.

A domain whose reads go through `@lobechat/replica` keeps its data in the same
id-keyed `<domain>Map` views, plus one `<domain>Replica` bookkeeping field per
view; its resources live in a sibling `projection.ts`. See
[replica-backed server data](../zustand/SKILL.md#replica-backed-server-data).
