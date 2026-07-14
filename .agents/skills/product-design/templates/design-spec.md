# <Surface> — <what this round changes>

**Date:** YYYY-MM-DD
**Status:** aligning | scoped | shipped
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

## 2. Diagnosis

Name the **structural** error(s) — something wrong regardless of taste. Not "it
looks dated".

If you cannot name one, you do not have a diagnosis. You have an opinion.

---

## 3. Principles

Only the principles this diagnosis actually forced. Each with a **rejected
alternative** attached — a principle with no rejected alternative is decoration.

---

## 4. Information architecture

Block by block. For each:

- what lands there, and **why that and not something else**
- the **business concept** behind it
- what it looks like empty, and at 100×

---

## 5. Scope — what does the business already support?

| Bucket                               | Capability | Meaning                             |
| ------------------------------------ | ---------- | ----------------------------------- |
| ✅ Already modeled, already exposed  |            | Rearranging what is there           |
| ⚠️ Already modeled, never exposed    |            | Nearly free product                 |
| ❌ Not a concept in the business yet |            | A domain change. Order of magnitude |

**Ships this round:** ✅ + ⚠️.
**Does not, and why:** every ❌ item **by name, with its cost**. Silence reads as
an oversight (`P-11`).

---

## 6. Red lines

Concepts the business does not have, which therefore cannot be designed around —
only proposed as domain changes. **Bold them.** These are not preferences
(`P-06`).

---

## 7. Reality-check log

The `T` of SCLPT. One row per assumption that met the business model.
Schema: [trace-schema.md](../references/trace-schema.md).

**"What is true" must be written in domain language.** If you cannot state the
fact without naming a table, it is probably not a product finding.

| Assumption | What is true | Model | Verdict | Pattern |
| ---------- | ------------ | ----- | ------- | ------- |
|            |              |       |         |         |

**Saturation:** did this round's grounding overturn anything? If a full pass
overturned nothing, say so — the implementation model is mined out for this
surface, and the next round's budget belongs to the **mental** model.

**New patterns written back:** `P-nn`, … (or "none — all predicted").
Check each against [canon.md](../references/canon.md) first: an instance of
something already named, or genuinely new?

---

## 8. Open decisions

Only the ones that **change the shape of the answer**. Each with a recommendation
and its reasoning. Not a list of everything unresolved.
