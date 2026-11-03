const content = `# lh eval - Evaluation Workflow Management

Manage evaluation benchmarks, datasets, test cases and runs, including external
evaluation workflows. Resource IDs are passed with \`--id\` (not \`--run-id\` /
\`--dataset-id\`) on \`get\` / \`update\` / \`delete\` style commands.

## Runs

- \`lh eval run list [--dataset-id <id>] [--experiment-id <id>] [--status <status>]\` - List runs
- \`lh eval run get --id <id> [--external]\` - Get run information
- \`lh eval run create --dataset-id <id> --agent-id <id> [-n <name>] [--external]\` - Create a run
- \`lh eval run claim --id <id>\` - Claim a pending external run and fetch its workload
- \`lh eval run start --id <id>\` / \`lh eval run abort --id <id>\` - Start or abort a run
- \`lh eval run progress --id <id>\` / \`lh eval run results --id <id>\` - Progress and results
- \`lh eval run set-status --id <id> --status <completed|external>\` - Set run status

## External evaluation workflow

- \`lh eval run-topic list --run-id <id> [--only-external]\` - List topics in a run
- \`lh eval thread list --topic-id <id>\` - List threads by topic
- \`lh eval message list --topic-id <id> [--thread-id <id>]\` - List messages
- \`lh eval agent run --run-id <id> --case-id <id>\` - Execute one case of a claimed run
- \`lh eval run-topic report-result --run-id <id> --topic-id <id> --score <n> --correct <true|false> --result-json <json>\` - Report one result (\`--thread-id <id>\` when k > 1)
- \`lh eval run-topic report-results --run-id <id> --file <path>\` - Batch report results

## Datasets and test cases

- \`lh eval dataset list [--benchmark-id <id>]\` / \`lh eval dataset get --id <id> [--external]\`
- \`lh eval testcase list --dataset-id <id>\` / \`lh eval testcase get --id <id>\`
- \`lh eval testcase count --dataset-id <id>\` - Count test cases
- \`lh eval benchmark list\` / \`lh eval experiment list\` - Benchmarks and experiments

## Tips

- Every eval command accepts \`--json\` for a structured envelope
- Use \`report-result\` to submit scores for individual topics
`;

export default content;
