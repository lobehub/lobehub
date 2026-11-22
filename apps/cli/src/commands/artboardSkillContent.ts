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

**Screens.** A board shows a screen. Write each screen as a plain HTML page, a real screen of the product at the board's size with its own layout, colors, type and inline SVG, in a folder laid out like the artboard (for example \`pages/checkout/a.html\`, shared CSS in \`shared/base.css\`, screenshots in \`shots/\`, all referenced by relative paths). A board points at its page with source \`{"kind":"file","path":"pages/checkout/a.html"}\`; the file may not be written yet, and the board shows the page as soon as it is. Build the artboard in this order, so the user watches it fill in:

1. Lay out the whole structure first: one \`lh artboard create --ops\` (or \`lh artboard update --ops\` on an artboard that exists) with the pages, groups, edges and every board, each board's source pointing at the path its page will have although that file is not written yet.
2. Then write the pages one board at a time with \`lh artboard files write <id> <path> --from <file>\` (or from stdin), each as soon as it is ready, so the boards appear one by one. Write the shared CSS and images a page uses before the page.
3. \`lh artboard push <id> <dir>\` re-syncs a whole folder later: it uploads only the files that changed, and with \`--prune\` deletes the artboard files that are no longer in the folder.

- a page cannot fetch or open network connections; https images, fonts, styles and scripts load;
- to change a screen, write its file again: every board showing it updates and comments on it are marked outdated;
- \`lh artboard files list <id>\`, \`lh artboard files read <id> <path>\` and \`lh artboard files rm <id> <path>\` list, print and remove files; a board whose file is removed stays and shows the page again once it is written;
- a screenshot of the current product can be an image board: write it under \`shots/\` and point a board at it.

A board of type "decision" needs no source.

If no screen can be made (writing the files is refused or times out), tell the user in one line which step failed and hold the discussion in chat. Never stand a decision board or a text card in for a screen: a decision board marks where the journey branches and shows only a short title.

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

**Comments and questions.** The user comments on boards, groups and pages. Answer them on the artboard, not only in chat:

- \`lh artboard comments <id>\` prints the threads waiting for you, each with its id and what it is on; the ones printed count as read;
- \`lh artboard reply <commentId> <text>\` answers a thread, and \`lh artboard resolve <commentId>\` closes it once what it asks for is done;
- to ask about one screen, group or page, use \`lh artboard ask <id> --board <boardId> <question>\` (or \`--group\`, \`--page\`) instead of asking in chat. The user answers in that thread, and the artboard cannot be finalized while your question is open: resolve it once you have the answer.

## 4. Hand over

Reply with what is on the artboard and what is waiting for the user's choice. Do not ask the same questions again in chat. A question about something on the artboard goes there with \`lh artboard ask\`; ask in your reply only what concerns no screen.

## 5. After the user submits

The picks and the user's new comments arrive as one message in this conversation. Then:

1. \`lh artboard read <id>\` to see each round's chosen board; a round the user left unpicked takes your recommendation.
2. \`lh artboard comments <id>\` for the threads and their ids; the user's answers to your questions are there too.
3. Apply the picks and what the comments ask for in one \`lh artboard update\`.
4. Reply in each thread with what you changed, then resolve the threads that are done and the questions that are answered.
5. Open the next rounds if something is still undecided; otherwise say the requirement is settled and what was decided.

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
