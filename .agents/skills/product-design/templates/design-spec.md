# <Surface> — <what this round changes>

**Date:** YYYY-MM-DD
**Status:** aligning | scoped | shipped
**Scope:** one sentence. Say what is **out** of scope too.
**Prototype:** path, if any

---

## 1. Current state (grounded)

What renders today, and where each piece's data comes from. **Every claim needs
`file:line`.** If you cannot cite it, you have not grounded it — go read the code.

---

## 2. Diagnosis

Name the **structural** error(s). Not "it looks dated" — something that is wrong
regardless of taste. See [pattern-base.md](../references/pattern-base.md) Class E.

If you cannot name one, you do not have a diagnosis. You have an opinion.

---

## 3. Principles

Only principles this diagnosis actually forced. Each one should have a **rejected
alternative** attached — a principle with no rejected alternative is decoration.

---

## 4. Information architecture

The proposed structure, block by block. For each block, state:

- what lands there, and **why that and not something else**
- the exact data source (`table.column` / endpoint)
- what happens when it is empty, and when it is at 100×

---

## 5. Data capability audit

The step that decides scope. Sort everything the design needs:

| Bucket                           | Capability | Cost      |
| -------------------------------- | ---------- | --------- |
| ✅ Available now                 |            | zero      |
| ⚠️ Blocked by a predicate/select |            | cheap     |
| ❌ Needs a new model             |            | expensive |

**What ships this round:** the ✅ subset (+ ⚠️ if genuinely cheap).
**What does not, and why:** name every ❌ item with its cost. Silence reads as an
oversight (`P-13`).

---

## 6. Constraints and red lines

Hard limits the design must respect — missing columns, ownership predicates,
privacy boundaries. **Bold them.** These are not preferences (`P-06`).

---

## 7. Reality-check log

The `T` of SCLPT. One row per assumption that met the code.
Schema: [trace-schema.md](../references/trace-schema.md).

| Assumption | Code fact (`file:line`) | Layer | Verdict | Pattern |
| ---------- | ----------------------- | ----- | ------- | ------- |
|            |                         |       |         |         |

**Saturation:** did this round's grounding overturn anything? If a full pass
overturned nothing, say so — L1/L2 are mined out for this surface, and the next
round's budget belongs to L0.

**New patterns written back:** `P-nn`, … (or "none — all predicted").

---

## 8. Open decisions

Only the ones that **change the shape of the answer**. Each with a
recommendation and its reasoning. Not a list of everything unresolved.
