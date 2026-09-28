<!--
AGENT-INSTRUCTIONS — follow these. Keep them commented out. Do not copy them into the visible description. Delete them after you comply.

You are the agent preparing this pull request. Fill the Summary section for every contribution: what changed, screenshots, how it was tested, acceptance, and the related issue. Set Contribution source based on how the change was produced, independently of whether AI assistance details are disclosed. Never remove the source label, including for organization members. If the source cannot be established, write `Unknown` rather than assuming human-only.

HUMAN ONLY — a person produced the change without AI assistance.
- Set Contribution source to `Human-only`.
- Delete the entire AI assistance section.

AI ASSISTED — AI contributed to the implementation, tests, documentation, or review, including work completed jointly with a person.
- Set Contribution source to `AI-assisted`.
- Human edits or review of AI-generated work do not make it human-only.
- Separately decide whether to include AI assistance details:
  - Run `gh api user/memberships/orgs/lobehub`.
  - `"state": "active"` means the author is a lobehub organization member. Delete the AI assistance section to avoid disclosing internal details, but keep Contribution source as `AI-assisted`.
  - Otherwise, including errors or pending membership, fill the AI assistance section.

Do not include user prompts or conversation transcripts by default. Include them only when the author explicitly requests sharing them, after reviewing the exact text for sensitive information and confirming it for publication. Creating a pull request does not imply consent to publish the conversation.

Describe the work from the final diff and verification evidence, not by summarizing private conversations. Exclude private background, customer data, credentials, and internal URLs. Check any attached logs or screenshots for sensitive information too.

When the AI assistance section is required you MUST fill all six fields. Leaving a placeholder is not done. Report only known facts; mark unavailable metadata as `unknown` and do not claim human review or checks that did not happen.

1. Harness. The product and version you are running.
2. Model. The model id this session called.
3. Thinking level. The thinking or reasoning level this session was set to. Write `n/a` only when this harness has no thinking-level control.
4. Division of work. What AI implemented and what the author actually reviewed. State if human review is pending.
5. Implementation rationale. The cause or requirement addressed, why this approach was chosen, and relevant limitations. Refer to the description above when it already covers this.
6. Verification. Checks actually run, their results, and what remains unverified. Refer to the Test section or linked evidence rather than duplicating it.

Use one AI assistance section per pull request; list multiple tools or models together when applicable.
-->

### Summary

Contribution source: <!-- Set to AI-assisted, Human-only, or Unknown. Required for every PR; independent of organization membership. -->

<!-- Brief and heads-up -->

<!-- If this PR includes UI changes, please provide screenshots or videos. Remove the table when nothing visual changed. -->

| Before | After |
| ------ | ----- |
| ...    | ...   |

#### Test

<!-- How you tested your changes -->

<!-- For product AI behavior, note the scenarios you tried without including private conversation content. -->

- [ ] Tested locally
- [ ] Added/updated tests
- [ ] No tests needed

<!-- Acceptance round for user-visible changes (AGENTS.md → Acceptance); or state why none is needed -->

- Acceptance: ...

#### 🔗 Related Issue

<!-- Link to the issue that is fixed by this PR -->

<!-- Example: Fixes #xxx, Closes #xxx, Related to #xxx, Fixes LOBE-xxx -->

### AI assistance

<!--
AGENT-INSTRUCTIONS — keep this commented out.
Delete this section for human-only contributions or confirmed lobehub organization members. Keep the Contribution source label in Summary; omitting details never changes AI-assisted work to Human-only.
For AI-assisted contributions without confirmed organization membership, fill every field below. Do not leave the placeholders.
Harness: product and version.
Model: the model id this session called.
Thinking level: the level this session was set to, or `n/a` when this harness has none.
Division of work: AI contributions and actual human review; state if review is pending.
Implementation rationale: why the final approach addresses the problem and any limitations.
Verification: actual checks, results, and gaps; a reference to the Test section is enough.
Use only the final diff and verification evidence for the work summary, not private conversation summaries. Do not invent review or test results. Mark unavailable metadata as `unknown`.
-->

- Harness:
- Model:
- Thinking level:
- Division of work:
- Implementation rationale:
- Verification:
