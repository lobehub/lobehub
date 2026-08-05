# Prompt-Surface Risk

Read this reference when the diff changes system roles, tool or parameter descriptions, context
assembly, prompt injection order, or defaults copied into user-owned records.

Prompts are production behavior without compiler enforcement. Review the behavioral delta, not the
writing style.

## Checks

- Tool and parameter descriptions decide whether the model calls a tool and with which arguments.
  Name the affected tool and the expected direction of the selection-rate change.
- For a removed or weakened instruction, run `git log -S` on the removed text and recover why it was
  added. Confirm the instruction was not moved elsewhere in the assembled prompt.
- Treat safety and refusal constraints as enforcement. A weakened security constraint also belongs
  to the security dimension.
- Treat assembly-order and injection-point changes as behavior changes even when no words changed.
- Determine whether the prompt is read dynamically or copied into persisted user records. A default
  change does not update existing copies without a backfill.
- Account for prompt length and prefix-cache invalidation. Cost arithmetic belongs to
  `observability`; rollout and recovery belong here.
- Require one validation path for a user-facing prompt change: an eval, a before/after transcript on
  a real case, or a staged rollout.

## Findings and non-findings

Report a finding when the diff:

- removes or weakens an instruction without recovering its original reason;
- changes tool-selection or argument behavior with no validation;
- presents an assembly-order or behavioral change as a wording cleanup;
- intends to update persisted prompt copies without a backfill; or
- reaches every user immediately while revert is the only validation and recovery mechanism.

Do not report:

- typo, formatting, template-variable, or translation fixes with no model-visible behavioral delta;
- product-authorized behavior changes merely because the old wording was different; review their
  validation and rollout instead;
- writing-quality or token-efficiency preferences; or
- a prompt change already covered by a representative eval or staged validation plan.

## Severity

- **P0** only for removed safety/refusal constraints or broken machine-parsed contracts.
- **P1** for unvalidated behavioral, tool-selection, or assembly-order changes.
- Prompt findings are never safe auto-fixes; wording is a behavior decision.
