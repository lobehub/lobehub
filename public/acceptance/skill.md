# Install Acceptance

Acceptance lets a coding agent verify a delivery and collect evidence for human review.
Run the following setup from the root of the project the user wants to verify.

## 1. Install the CLI

Install or update the LobeHub CLI (requires Node.js 22.15 or later):

```sh
npm install -g @lobehub/cli
```

## 2. Install the Acceptance skill

From the project root, run:

```sh
lh acceptance install
```

This downloads the Acceptance skill and its companion resources from the default
branch of <https://github.com/lobehub/acceptance> into
`.agents/skills/acceptance/` and wires supported coding-agent skill directories.
Existing files are preserved by default. Use `lh acceptance update` only when the
user wants to refresh an existing installation.

## 3. Verify setup and start a review

Confirm that `.agents/skills/acceptance/SKILL.md` exists, read it, and follow its
instructions and referenced resources. Do not replace it with this installation guide.
Reload skills or start a new coding-agent session so the installed skill is available.

Tell the user which project was configured and whether installation completed.
The user can then invoke `/acceptance` in their coding agent to verify a delivery.
Reports and evidence are saved under `.acceptances/` in the project.

## Share reports and collaborate

To share a report or collaborate with others in LobeHub, sign in:

```sh
lh login
```

Let the user complete the browser sign-in. Never request passwords or tokens in chat.
Then publish the existing report, replacing `<subject>` with its acceptance directory name:

```sh
lh acceptance publish ".acceptances/<subject>"
```

Publishing uploads the existing rounds and saved review decisions; do not rerun
verification just to share a report. Published reviews appear at
<https://lobehub.com/acceptance>.
