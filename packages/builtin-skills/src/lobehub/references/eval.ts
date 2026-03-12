const content = `# lh eval - Evaluation Workflow Management

Manage external evaluation workflows for testing agent quality.

## Subcommands

- \`lh eval run get --run-id <id>\` - Get run information
- \`lh eval run set-status --run-id <id> --status <completed|external>\` - Set run status
- \`lh eval dataset get --dataset-id <id>\` - Get dataset information
- \`lh eval run-topics list --run-id <id> [--only-external]\` - List topics in a run
- \`lh eval threads list --topic-id <id>\` - List threads by topic
- \`lh eval messages list --topic-id <id> [--thread-id <id>]\` - List messages
- \`lh eval test-cases count --dataset-id <id>\` - Count test cases
- \`lh eval run-topic report-result --run-id <id> --topic-id <id> --score <n>\` - Report result

## Tips

- Evaluation runs test agent responses against datasets
- Use \`report-result\` to submit scores for individual topics
`;

export default content;
