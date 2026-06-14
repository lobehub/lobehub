# LobeHub Design Values (设计价值观)

The philosophy behind every LobeHub interface. Read this before designing or
reviewing a flow; the per-aspect execution rules live in the parent
[SKILL.md](../SKILL.md) and each checklist item is tagged with the value(s) it serves.

Adapted from Ant Design's design values
(<https://ant.design/docs/spec/values-cn>, <https://zhuanlan.zhihu.com/p/44809866>).
LobeHub adopts all four.

## 自然 (Natural)

Minimise cognitive load. Digital products keep getting more complex while human
attention stays scarce — so the interface should feel as effortless as the
physical world. The next step should be obvious without thinking; the product
proactively carries the user forward (sensible defaults, AI-assisted decisions,
smooth transitions) rather than making them stop and figure things out.

## 意义感 (Meaningful)

Every screen is rooted in the user's real goal, not an isolated feature. Make the
objective clear, give immediate feedback on the result of each action, and always
point at the next meaningful step. Calibrate difficulty — neither a patronising
over-simplification nor an overwhelming wall — so the user keeps a sense of
progress and accomplishment.

## 确定性 (Certainty)

Low-entropy, predictable interactions. Reuse the same patterns, components, and
wording so behaviour is never surprising. Keep a single clear focus per surface,
and design **every** state (empty / loading / error / success) so nothing is left
undefined. Restraint over cleverness: fewer, consistent rules beat many bespoke
ones.

## 生长性 (Growth)

The product grows together with the user. As needs deepen and roles evolve,
surface advanced capabilities progressively and make related features
discoverable at the moment they become relevant — without crowding the novice
path. Bridge product value to the user's changing scenarios and aim for
human–machine symbiosis (人机共生): the user and the agent co-evolve, each making
the other more capable over time.

## Priority when values conflict

For moment-to-moment interaction decisions: **意义感 ≳ 自然 > 确定性** — never
sacrifice the user's goal or forward momentum just to keep things uniform.

**生长性 (Growth)** is a longer-horizon lens: weigh it when shaping how a feature
is discovered and how it scales with the user, not when resolving a single-screen
layout trade-off.
