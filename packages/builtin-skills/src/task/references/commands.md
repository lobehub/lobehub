# lh task - Complete Command Reference

## Core Commands

- `lh task list [--status <status>] [--root] [--parent <id>] [--agent <id>] [-L <limit>] [--tree]` - List tasks
  - `--status`: pending, running, paused, completed, failed, canceled
  - `--root`: Only root tasks (no parent)
  - `--tree`: Display as tree structure
- `lh task view <id>` - View task details (instruction, workspace, activities)
- `lh task create -i <instruction> [-n <name>] [--agent <id>] [--parent <id>] [--priority <0-4>]` - Create task
  - Priority: 0=none, 1=urgent, 2=high, 3=normal, 4=low
- `lh task edit <id> [-n <name>] [-i <instruction>] [--status <status>] [--priority <0-4>] [--agent <id>]` - Update task
- `lh task delete <id> [--yes]` - Delete task
- `lh task clear [--yes]` - Delete all tasks
- `lh task tree <id>` - Show subtask tree with dependencies

## Lifecycle Commands

- `lh task start <id> [--no-run] [-p <prompt>] [-f] [-v]` - Start task (pending → running)
  - `--no-run`: Only update status, skip agent execution
  - `-f, --follow`: Follow agent output in real-time
  - `-v, --verbose`: Show detailed tool call info
- `lh task run <id> [-p <prompt>] [-c <topicId>] [-f] [--topics <n>] [--delay <s>]` - Run/re-run agent execution
  - `-c, --continue`: Continue on existing topic
  - `--topics <n>`: Run N topics in sequence
- `lh task pause <id>` - Pause running task
- `lh task resume <id>` - Resume paused task
- `lh task complete <id>` - Mark as completed
- `lh task cancel <id>` - Cancel task
- `lh task comment <id> -m <message>` - Add comment
- `lh task sort <parentId> <id1> <id2> ...` - Reorder subtasks
- `lh task heartbeat <id>` - Send manual heartbeat
- `lh task watchdog` - Detect and fail stuck tasks

## Checkpoint Commands

- `lh task checkpoint view <id>` - View checkpoint config
- `lh task checkpoint set <id> [--on-agent-request <bool>] [--topic-before <bool>] [--topic-after <bool>] [--before <ids>] [--after <ids>]` - Configure checkpoints
  - `--on-agent-request`: Allow agent to request review
  - `--topic-before/after`: Pause before/after each topic
  - `--before/after <ids>`: Pause before/after specific subtask identifiers

## Review Commands (LLM-as-Judge)

- `lh task review view <id>` - View review config
- `lh task review set <id> [--model <model>] [--provider <provider>] [--max-iterations <n>] [--no-auto-retry] [--recursive]` - Configure review
- `lh task review criteria list <id>` - List review rubrics
- `lh task review criteria add <id> -n <name> [--type <type>] [-t <threshold>] [-d <description>] [--value <value>] [--pattern <pattern>] [-w <weight>] [--recursive]` - Add rubric
  - Types: llm-rubric, contains, equals, starts-with, ends-with, regex
  - Threshold: 0-100
- `lh task review criteria rm <id> -n <name> [--recursive]` - Remove rubric
- `lh task review run <id> --content <text>` - Manually run review

## Dependency Commands

- `lh task dep add <taskId> <dependsOnId> [--type <blocks|relates>]` - Add dependency
- `lh task dep rm <taskId> <dependsOnId>` - Remove dependency
- `lh task dep list <taskId>` - List dependencies

## Topic Commands

- `lh task topic list <id>` - List topics for task
- `lh task topic view <id> <topicId>` - View topic messages (topicId can be seq number like "1")
- `lh task topic cancel <topicId>` - Cancel running topic and pause task
- `lh task topic delete <topicId> [--yes]` - Delete topic and messages

## Document Commands (Workspace)

- `lh task doc create <id> -t <title> [-b <content>] [--parent <docId>] [--folder]` - Create and pin document
- `lh task doc pin <id> <documentId>` - Pin existing document
- `lh task doc unpin <id> <documentId>` - Unpin document
- `lh task doc mv <id> <documentId> <folder>` - Move document into folder (auto-creates folder)

## Tips

- All commands support `--json [fields]` for structured output
- Task identifiers use format like TASK-1, TASK-2, etc.
- Use `lh task tree` to visualize full task hierarchy before planning work
- Use `lh task comment` to log progress — comments appear in task activities
- Documents in workspace are accessible to the agent during execution
