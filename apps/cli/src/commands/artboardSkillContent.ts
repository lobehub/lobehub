export const artboardSkillDescription =
  'Lay out a feature or requirement on a LobeHub artboard so the user decides on the canvas. Use when the user wants to discuss, explore, shape or confirm a feature or requirement and this session runs inside a LobeHub project conversation (`LOBEHUB_TOPIC_ID` is set). In that case this skill takes the place of a generic brainstorming or requirements skill: the open decisions go on the artboard as choices, not into a run of questions in chat. Not for bug fixes, small or already specified changes, or questions about existing code.';

export const artboardSkillBody = `# Requirement artboard

An artboard is a canvas in the user's LobeHub project. You lay a requirement out on it: the screens, the flow between them, and the decisions you are unsure of as choices. The user picks on the canvas and submits; you carry on from their picks. You work on it through the \`lh\` CLI, which is already installed and signed in for this run.

## 1. Check first

- \`LOBEHUB_TOPIC_ID\` is set: this session runs inside a LobeHub conversation.
- \`lh artboard --help\` prints the artboard commands.

If either fails, or \`lh artboard create\` is refused, say so in one line and hold the discussion in chat the way you normally would. Do not install or upgrade \`lh\`.

## 2. Read before you draw

Read the repository for the data and the screens the requirement touches, so the artboard starts from what exists. Change no code while the requirement is being discussed.

## 3. Lay it out

Run \`lh man artboard\` for the exact flags and \`lh artboard ops\` for the shape of every op; both come from the installed CLI and are not repeated here. One requirement gets one artboard: \`lh artboard create\` makes it for this conversation's project, \`lh artboard list\` shows the ones that already exist.

**Screens.** A board shows a screen. Build each screen as a Canvas, a page the artboard renders live; the artboard commands do not make one:

- \`lh artifact guide canvas\` gives the components and rules a Canvas page follows;
- write one page per screen and save it with \`lh artifact save <file> --json\`, which returns the \`canvasId\` and \`version\` the board's source takes. Saving the same file again makes a new version of that Canvas; \`--new\` starts another one. Do not publish it: the artboard only needs it saved;
- a screen that already exists as a picture (a screenshot of the current product) can be an image board instead: upload it with \`lh file upload\`;
- a page that was already published (a \`dep_…\` id or a \`/share/artifact/…\` link) can be a board as it is, through a deployment source; it is shown at the release you pin, the latest by default.

\`lh man artifact\` and \`lh man file\` have the details. A board of type "decision" needs no source.

If no screen can be made (the save or the upload is refused or times out), tell the user in one line which step failed and hold the discussion in chat. Never stand a decision board or a text card in for a screen: a decision board marks where the journey branches and shows only a short title.

**Layout.**

- An artboard has pages; each page has its own coordinates. Use a second page when the choices would crowd the flow.
- Group the boards: one journey group for the flow the user will accept, and separate groups for options and references.
- In the journey group one board is one page state. Edges connect boards. The journey has exactly one starting screen, the only journey board no edge points to, and every other journey board is reached from it. No edge may point back to it: a way back to the start belongs in that screen's acceptance check. A journey that breaks this cannot be finalized. Label an edge, in at most four words, only when the two screens do not already show what the user does to get there.
- Where the flow branches, add a decision board, give each edge leaving it a condition, and mark the fallback branch as the default.
- Give every journey board an acceptance check: what the user must see on that page. A decision board takes none; one that carries a check is refused.
- You place every board; the user cannot move them. Boards are 640×400 unless you set a size. Leave 80 between boards in a row and lay a journey out left to right.
- A frame is drawn around each group (144 above its boards, 48 on the other sides). Leave 240 between the boards of two groups stacked vertically and 200 between groups side by side, measured from the lowest and rightmost board of a group. An update whose group frames overlap is refused.

**Choices.** Every decision you are not sure of becomes a round:

- add a round whose title is the question, then add each alternative as a board that carries that round's id and sits in an options group, and mark the one you would pick as recommended;
- one options group holds the options of exactly one round;
- the user submits every open round at once, so open only the rounds you want answered now.

## 4. Hand over

Reply with what is on the artboard and what is waiting for the user's choice. Do not ask the same questions again in chat. A question that is not a choice between designs has no place on the artboard yet: ask it in your reply.

## 5. After the user submits

The picks arrive as a message in this conversation. Then:

1. \`lh artboard read <id>\` to see each round's chosen board; a round the user left unpicked takes your recommendation.
2. Apply the picks to the journey in one \`lh artboard update\`.
3. Open the next rounds if something is still undecided; otherwise say the requirement is settled and what was decided.

## 6. After the user finalizes

Finalizing turns the journey into an acceptance. The message that arrives carries its link, and \`lh artboard read <id> --json\` gives its \`acceptanceId\`. Its flow is already published: one check per journey board, whose expected result is that board's acceptance check. Then:

1. Build the journey in this repository.
2. Verify it with the acceptance skill (\`lh acceptance install\` adds it to \`.agents/skills\` when it is missing), on that acceptance and its published flow: \`lh acceptance flow plan <acceptanceId>\` opens a round, \`lh acceptance flow record\` records each check's verdict, \`lh acceptance run evidence upload\` attaches a screenshot of the page to it, and \`lh acceptance flow complete\` closes the round. Do not publish another flow or create another acceptance: the artboard shows only this one.
3. Reply with the acceptance link and which checks passed or failed. Each journey board on the artboard then shows its check's result and screenshot.

## Editing rules

- \`lh artboard update\` needs the revision you last read. If it is refused as stale, read again and redo the change on the new revision.
- Every op in one update applies, or none does.
- Use only ids the CLI returned; never invent one. Inside one call, give an added item a ref so later ops can point at it.
- After the artboard is finalized, the journey group's boards, edges and checks are locked; other groups can still change.
`;
