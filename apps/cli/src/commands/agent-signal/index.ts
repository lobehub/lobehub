import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { log } from '../../utils/logger';

/**
 * Producer source types a developer may trigger manually for local testing.
 * Mirrors `AGENT_SIGNAL_TRIGGER_SOURCE_TYPES` on the server; kept inline so the
 * CLI bundle does not pull in server-only modules.
 */
const TRIGGER_SOURCE_TYPES = [
  'agent.nightly_review.requested',
  'agent.self_reflection.requested',
  'agent.self_feedback_intent.declared',
  'agent.user.message',
  'tool.outcome.completed',
  'tool.outcome.failed',
] as const;

type TriggerSourceType = (typeof TRIGGER_SOURCE_TYPES)[number];

export function registerAgentSignalCommand(program: Command) {
  const agentSignal = program
    .command('agent-signal')
    .description('Inspect and trigger Agent Signal source events');

  agentSignal
    .command('trigger')
    .description('Trigger an Agent Signal source event for the authenticated user')
    .requiredOption(
      '--source-type <type>',
      `Source type to emit. One of:\n  ${TRIGGER_SOURCE_TYPES.join('\n  ')}`,
    )
    .option('--agent <agentId>', 'Target agent ID (required for agent-scoped source types)')
    .option('--topic <topicId>', 'Topic ID to scope the event to')
    .option('--payload-json <json>', 'JSON object shallow-merged over the default payload')
    .option('--source-id <id>', 'Override the auto-derived dedupe source id')
    .option('--scope-key <key>', 'Override the auto-derived scope key')
    .option('--timestamp <ms>', 'Event timestamp in milliseconds')
    .option('--json', 'Output JSON')
    .action(
      async (options: {
        agent?: string;
        json?: boolean;
        payloadJson?: string;
        scopeKey?: string;
        sourceId?: string;
        sourceType: string;
        timestamp?: string;
        topic?: string;
      }) => {
        const sourceType = options.sourceType as TriggerSourceType;

        if (!TRIGGER_SOURCE_TYPES.includes(sourceType)) {
          console.error(
            `${pc.red('✗')} Invalid --source-type "${options.sourceType}". Expected one of: ${TRIGGER_SOURCE_TYPES.join(', ')}`,
          );
          process.exit(1);
          return;
        }

        let payloadOverride: Record<string, unknown> | undefined;
        if (options.payloadJson) {
          try {
            const parsed = JSON.parse(options.payloadJson);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
              throw new Error('payload must be a JSON object');
            }
            payloadOverride = parsed as Record<string, unknown>;
          } catch (error: any) {
            console.error(`${pc.red('✗')} Failed to parse --payload-json: ${error.message}`);
            process.exit(1);
            return;
          }
        }

        let timestamp: number | undefined;
        if (options.timestamp !== undefined) {
          timestamp = Number(options.timestamp);
          if (!Number.isFinite(timestamp)) {
            console.error(`${pc.red('✗')} --timestamp must be a number (milliseconds)`);
            process.exit(1);
            return;
          }
        }

        log.debug(
          'agent-signal trigger: sourceType=%s agent=%s topic=%s',
          sourceType,
          options.agent,
          options.topic,
        );

        const client = await getTrpcClient();

        try {
          const result = await client.agentSignal.triggerSourceEvent.mutate({
            agentId: options.agent,
            payloadOverride,
            scopeKey: options.scopeKey,
            sourceId: options.sourceId,
            sourceType,
            timestamp,
            topicId: options.topic,
          });

          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }

          if (!result.accepted) {
            console.log(
              `${pc.yellow('!')} Agent Signal is disabled for this account — event was not enqueued (scopeKey: ${pc.bold(result.scopeKey)})`,
            );
            return;
          }

          console.log(`${pc.green('✓')} Triggered ${pc.bold(sourceType)}`);
          console.log(`  Scope key:       ${result.scopeKey}`);
          console.log(`  Workflow run id: ${result.workflowRunId}`);
        } catch (error: any) {
          console.error(`${pc.red('✗')} Failed to trigger source event: ${error.message}`);
          process.exit(1);
        }
      },
    );
}
