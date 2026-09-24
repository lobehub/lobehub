<!--
AGENT-INSTRUCTIONS — follow these. Keep them commented out. Do not copy them into the visible description. Delete them after you comply.

You are the agent preparing this pull request. Decide who wrote the change, then edit this body.

HUMAN — a person wrote the code. No agent produced the diff.
- Fill the Human section.
- Delete the entire AI section.

AI — an agent produced the diff.
- Fill the Human section too: what changed, screenshots, how it was tested, acceptance, and the related issue.
- Then decide if the AI section stays:
  - Run `gh api user/memberships/orgs/lobehub`.
  - `"state": "active"` means the author is a lobehub organization member. Delete the entire AI section.
  - Anything else — 404, an error, pending, or the check failed — means an outside collaborator or an external contributor. The AI section is mandatory. Do not delete it.

Do not include user prompts or conversation transcripts by default. Include them only when the author explicitly requests sharing them, after reviewing the exact text for sensitive information and confirming it for publication. Creating a pull request does not imply consent to publish the conversation.

Describe the work from the final diff and verification evidence, not by summarizing private conversations. Exclude private background, customer data, credentials, and internal URLs. Check any attached logs or screenshots for sensitive information too.

When the AI section is mandatory you MUST fill all six fields. Leaving a placeholder is not done. Report only known facts; mark unavailable metadata as `unknown` and do not claim human review or checks that did not happen.

1. Harness. The product and version you are running.
2. Model. The model id this session called.
3. Thinking level. The thinking or reasoning level this session was set to. Write `n/a` only when this harness has no thinking-level control.
4. Division of work. What AI implemented and what the author actually reviewed. State if human review is pending.
5. Implementation rationale. The cause or requirement addressed, why this approach was chosen, and relevant limitations. Refer to the description above when it already covers this.
6. Verification. Checks actually run, their results, and what remains unverified. Refer to the Test section or linked evidence rather than duplicating it.

Use one AI section per pull request; list multiple tools or models together when applicable.
If you keep the AI section, delete the visible line "Delete this section if a person wrote the change."
-->

### Human

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

### AI

Delete this section if a person wrote the change.

<!--
AGENT-INSTRUCTIONS — keep this commented out.
A person wrote the change, or `gh api user/memberships/orgs/lobehub` returns `"state": "active"`: delete this entire AI section.
An agent wrote the change and the author is an outside collaborator or an external contributor: do not delete this section. Fill every field below. Do not leave the placeholders.
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
