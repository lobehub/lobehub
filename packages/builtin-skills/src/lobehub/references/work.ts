const content = `# lh work - Register What You Produced

A Work is a card under your reply that links to something you made: a file or a
web page. Users find their Works on the reply and in the resource library.

## Subcommands

- \`lh work create --file <path> [--title <title>] [--description <text>] [--json]\` - Upload a
  file you produced and show it as a Work card. The title defaults to the file name.
- \`lh work create --url <url> --title <title> [--description <text>] [--json]\` - Register an
  http(s) link you produced, such as a deployed site or a published post.
- \`lh work update <work-id> [--file <path>] [--title <title>] [--description <text>] [--json]\` -
  Add a new version to a Work you created. Options left out keep their values. A link
  keeps its URL: register a new link with \`lh work create --url <url> --title <title>\` instead.
- \`lh work delete <work-id> [--json]\` - Delete a Work you created by mistake. Its card and
  versions go; uploaded files stay. A Work a goal, delivery or project already holds cannot
  be deleted: update it instead.
- \`lh work lookup <github-pr-url>\` - Find the conversations linked to a GitHub pull request.

## When to use it

- Register a deliverable the user should open later: a report, a slide deck, a
  generated image, a deployed preview. Skip scratch files and intermediate output.
- Run these inside your agent run; they attach the Work to the current reply
  (\`LOBEHUB_OPERATION_ID\`, or \`--operation <id>\`).
- Creating the same file path or link again in this conversation adds a version to the
  same Work, so you can also re-run \`create\` after changing a file.
- Keep the \`id\` from \`--json\` to update the Work later.

## What not to register

- GitHub pull requests and issues, and Linear issues: they become Works automatically
  when you create or edit them, and \`lh work create\` refuses their links.
- Works registered automatically cannot be changed with \`lh work update\` or deleted with
  \`lh work delete\`.
- Several images in one card: use the \`lobe-work\` tool's \`createWork\` with \`type: collection\`
  instead of one file Work per image.
`;

export default content;
