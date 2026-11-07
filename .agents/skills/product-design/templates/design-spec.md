# <Surface> — <what this round changes>

**Date:** YYYY-MM-DD
**Status:** discovery | aligning | scoped | validated
**Scope:** one sentence. Say what is **out** of scope too.
**Prototype:** path, if any

---

## 1. What the business actually models

Not what the surface shows — what the **business** has. For the concepts this
surface touches:

- Which concepts, states and roles exist
- **What each state obliges someone to do** (a state nobody must act on is not a
  queue; a state a human is blocking is)
- **What each action does to the business** — the event it produces, in domain
  language
- **Which concepts the business does _not_ have.** Absences are findings, and
  they are the expensive ones

---

## 2. User view model

- Circumstance and job
- Lookup objects and proof attached to each
- First-scan questions and secondary dimensions
- Evidence for each claim: observed | reported | inferred
- Confidence and validation gaps

---

## 3. Diagnosis

Name the **structural** error(s) — something wrong regardless of taste. Not "it
looks dated".

If you cannot name one, you do not have a diagnosis. You have an opinion.

---

## 4. Principles

Only the principles this diagnosis actually forced. Each with a **rejected
alternative** attached — a principle with no rejected alternative is decoration.

---

## 5. Information architecture

Block by block. For each:

- what lands there, and **why that and not something else**
- the **business concept** behind it
- what it looks like empty, and at 100×

---

## 6. Scope — what does the business already support?

| Bucket                               | Capability | Meaning                                           |
| ------------------------------------ | ---------- | ------------------------------------------------- |
| ✅ Already modeled, already exposed  |            | Rearranging what is there                         |
| ⚠️ Already modeled, never exposed    |            | Lower domain risk; validate implementation cost   |
| ❌ Not a concept in the business yet |            | Domain expansion; assess cost and risk explicitly |

**Recommended coherent slice:** explain how it completes the user's job.
**Does not, and why:** every excluded item by name, with likely cost drivers.

---

## 7. Red lines

Concepts the business does not have, which therefore cannot be designed around —
only proposed as domain changes. **Bold them.** These are not preferences
(`P-06`).

---

## 8. Reality-check log

The `T` of SCLPT. One row per assumption that met the business model.
Schema: [trace-schema.md](../references/trace-schema.md).

**"What is true" must be written in domain language.** If you cannot state the
fact without naming a table, it is probably not a product finding.

| Assumption | What is true | Model | Verdict | Pattern |
| ---------- | ------------ | ----- | ------- | ------- |
|            |              |       |         |         |

**Coverage:** which sources, roles, permissions, states and lifecycle paths were
checked? What evidence was unavailable? Which claims remain low-confidence? If no
new gap was found, state only that none was found in this inspected scope.

**Pattern candidates:** list candidates or “none”. Check each against
[canon.md](../references/canon.md); append only after review and authorization.

---

## 9. Open decisions

Only the ones that **change the shape of the answer**. Each with a recommendation
and its reasoning. Not a list of everything unresolved.
