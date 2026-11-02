import { EXPERTISE_ENFORCEMENTS, EXPERTISE_RULE_DIRECTIONS } from '@lobechat/types';
import type { Command } from 'commander';
import pc from 'picocolors';

import type { TrpcClient } from '../api/client';
import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';
import { resolveAgentId } from './agent/resolveAgentId';

const COMPILABILITIES = ['compilable', 'not-compilable'] as const;
const REASON_KINDS = ['mechanism', 'taste'] as const;

interface AgentOptions {
  agent?: string;
  slug?: string;
}

interface DomainOptions extends AgentOptions {
  domain?: string;
}

interface JsonOptions {
  json?: string | boolean;
}

function printJson(data: unknown, options: JsonOptions) {
  const fields = typeof options.json === 'string' ? options.json : undefined;
  outputJson(data, fields);
}

function fail(message: string): never {
  log.error(message);
  process.exit(1);
}

function assertChoice(flag: string, value: string | undefined, choices: readonly string[]) {
  if (value !== undefined && !choices.includes(value)) {
    fail(`Invalid ${flag}: ${value}. Must be one of: ${choices.join(', ')}`);
  }
}

function withAgentOptions<T extends Command>(command: T): T {
  return command.option('--agent <agentId>', 'Agent ID').option('--slug <slug>', 'Agent slug') as T;
}

function withDomainOptions<T extends Command>(command: T): T {
  return withAgentOptions(command.option('--domain <domainId>', 'Domain ID'));
}

async function resolveAgent(client: TrpcClient, options: AgentOptions) {
  // The resolver's own message names its positional form, which these commands do not have.
  if (!options.agent && !options.slug) fail('Either --agent or --slug is required.');
  return resolveAgentId(client, { agentId: options.agent, slug: options.slug });
}

async function listAgentDomains(client: TrpcClient, options: AgentOptions) {
  const agentId = await resolveAgent(client, options);
  const { domains } = await client.expertise.listByAgent.query({ agentId });
  return { agentId, domains };
}

/**
 * Resolve the domains a command works on.
 *
 * `--domain` alone is taken as given (the server authorizes it). With an agent the domain must be
 * one of that agent's, so a mistyped pair fails instead of writing to the wrong agent.
 */
async function resolveDomainIds(client: TrpcClient, options: DomainOptions): Promise<string[]> {
  if (!options.agent && !options.slug) {
    if (options.domain) return [options.domain];
    fail('One of --domain, --agent or --slug is required.');
  }

  const { agentId, domains } = await listAgentDomains(client, options);
  if (!options.domain) return domains.map((domain) => domain.id);
  if (!domains.some((domain) => domain.id === options.domain)) {
    fail(`Domain ${options.domain} is not bound to agent ${agentId}.`);
  }
  return [options.domain];
}

/** Writes need exactly one target: an agent with several domains never gets one picked for it. */
async function resolveSingleDomainId(client: TrpcClient, options: DomainOptions): Promise<string> {
  const ids = await resolveDomainIds(client, options);
  if (ids.length === 0) fail('This agent has no expertise domains.');
  if (ids.length > 1) {
    fail(`This agent has ${ids.length} domains, pick one with --domain: ${ids.join(', ')}`);
  }
  return ids[0];
}

export function registerExpertiseCommand(program: Command) {
  const expertise = program
    .command('expertise')
    .description('Manage self-evolving expertise: domains, lessons and rules');

  // ── domains ───────────────────────────────────────────

  withAgentOptions(expertise.command('domains').description('List the domains bound to an agent'))
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: AgentOptions & JsonOptions) => {
      const client = await getTrpcClient();
      const { domains } = await listAgentDomains(client, options);

      if (options.json !== undefined) {
        printJson(domains, options);
        return;
      }

      if (domains.length === 0) {
        console.log('No expertise domains found.');
        return;
      }

      printTable(
        domains.map((domain) => [
          domain.id,
          truncate(domain.title, 40),
          String(domain.lessons.length),
          String(domain.runCount),
          domain.lastPracticedAt ? timeAgo(domain.lastPracticedAt) : '',
        ]),
        ['ID', 'TITLE', 'LESSONS', 'RUNS', 'LAST PRACTICED'],
      );
    });

  // ── lessons ───────────────────────────────────────────

  const lessons = expertise.command('lessons').description('Read and teach lessons');

  withDomainOptions(lessons.command('list').description('List active lessons'))
    .option('--layer <layer>', 'Filter by layer')
    .option('--search <text>', 'Filter by title')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: DomainOptions & JsonOptions & { layer?: string; search?: string }) => {
      const client = await getTrpcClient();
      const domainIds = await resolveDomainIds(client, options);
      const results = await Promise.all(
        domainIds.map((domainId) =>
          client.expertise.listLessons.query({
            domainId,
            layer: options.layer,
            search: options.search,
          }),
        ),
      );
      const items = results.flat();

      if (options.json !== undefined) {
        printJson(items, options);
        return;
      }

      if (items.length === 0) {
        console.log('No lessons found.');
        return;
      }

      printTable(
        items.map((lesson) => [
          lesson.id,
          lesson.domainId,
          lesson.code,
          lesson.tier,
          String(lesson.hitCount),
          truncate(lesson.title, 60),
        ]),
        ['ID', 'DOMAIN', 'CODE', 'TIER', 'HITS', 'TITLE'],
      );
    });

  lessons
    .command('view <lessonId>')
    .description('View a lesson or rule with its sections and recent hits')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (lessonId: string, options: JsonOptions) => {
      const client = await getTrpcClient();
      const result = await client.expertise.getLesson.query({ lessonId });
      if (!result) fail(`Lesson not found: ${lessonId}`);

      if (options.json !== undefined) {
        printJson(result, options);
        return;
      }

      const { hits, lesson } = result;
      console.log(pc.bold(`${lesson.code}  ${lesson.title}`));
      console.log(`  ID:       ${lesson.id}`);
      console.log(`  Domain:   ${lesson.domainId}`);
      console.log(`  Status:   ${lesson.status}`);
      console.log(`  Hits:     ${lesson.hitCount}`);
      console.log(`  Revision: ${lesson.currentRevision}`);
      for (const section of lesson.sections ?? []) {
        console.log();
        console.log(pc.cyan(section.key));
        console.log(section.body);
      }
      if (hits.length > 0) {
        console.log();
        console.log(pc.dim(`${hits.length} recent hit(s); use --json for details.`));
      }
    });

  withDomainOptions(
    lessons
      .command('teach <text>')
      .description('Teach a lesson in your own words (one text becomes one lesson)'),
  ).action(async (text: string, options: DomainOptions) => {
    const client = await getTrpcClient();
    const domainId = await resolveSingleDomainId(client, options);
    const result = await client.expertise.teachLesson.mutate({ domainId, text });
    if (!result) fail(`Domain not found: ${domainId}`);
    console.log(`${pc.green('✓')} Taught lesson ${pc.bold(result.code)} (${result.id})`);
  });

  lessons
    .command('revise <lessonId> <text>')
    .description('Correct a lesson; the text replaces its limits section as a new revision')
    .action(async (lessonId: string, text: string) => {
      const client = await getTrpcClient();
      const result = await client.expertise.reviseLesson.mutate({ lessonId, text });
      if (!result) fail(`Lesson not found: ${lessonId}`);
      console.log(`${pc.green('✓')} Revised ${pc.bold(lessonId)} (revision ${result.revision})`);
    });

  lessons
    .command('retire <lessonId>')
    .description('Retire a lesson so it stops being practiced')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (lessonId: string, options: { yes?: boolean }) => {
      if (!options.yes && !(await confirm('Retire this lesson?'))) {
        console.log('Cancelled.');
        return;
      }

      const client = await getTrpcClient();
      const result = await client.expertise.retireLesson.mutate({ lessonId });
      if (!result) fail(`Lesson not found: ${lessonId}`);
      console.log(`${pc.green('✓')} Retired ${pc.bold(lessonId)}`);
    });

  lessons
    .command('restore <lessonId>')
    .description('Put a retired lesson back into practice')
    .action(async (lessonId: string) => {
      const client = await getTrpcClient();
      const result = await client.expertise.restoreLesson.mutate({ lessonId });
      if (!result) fail(`Cannot restore ${lessonId}: not found, or merged into another rule.`);
      console.log(`${pc.green('✓')} Restored ${pc.bold(lessonId)}`);
    });

  // ── rules ─────────────────────────────────────────────

  const rules = expertise.command('rules').description('Manage rules and their groups');

  withAgentOptions(rules.command('list').description('List rules grouped by domain'))
    .option('--domain <domainId>', 'Only this domain')
    .option('--include-retired', 'Include retired rules')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: DomainOptions & JsonOptions & { includeRetired?: boolean }) => {
      const client = await getTrpcClient();
      const { backlogRounds, groups } = await client.expertise.listRules.query();

      // The endpoint lists everything in scope; narrowing to an agent uses the same domain set
      // the agent's runs resolve, so this cannot drift from `lh expertise domains`.
      const scoped =
        options.agent || options.slug || options.domain
          ? new Set(await resolveDomainIds(client, options))
          : undefined;
      const visible = groups
        .filter((group) => !scoped || scoped.has(group.domain.id))
        .map((group) => ({
          ...group,
          rules: options.includeRetired
            ? group.rules
            : group.rules.filter((rule) => rule.status === 'active'),
        }));

      if (options.json !== undefined) {
        printJson(visible, options);
        return;
      }

      if (visible.length === 0) {
        console.log('No rule groups found.');
        return;
      }

      for (const group of visible) {
        console.log();
        console.log(pc.bold(pc.cyan(`── ${group.domain.title} (${group.domain.id}) ──`)));
        if (group.rules.length === 0) {
          console.log(pc.dim('No rules.'));
          continue;
        }
        printTable(
          group.rules.map((rule) => [
            rule.id,
            rule.code,
            rule.status,
            rule.enforcement,
            String(rule.hitCount),
            truncate(rule.title, 60),
          ]),
          ['ID', 'CODE', 'STATUS', 'ENFORCEMENT', 'HITS', 'TITLE'],
        );
      }

      if (backlogRounds > 0) {
        console.log();
        console.log(pc.dim(`${backlogRounds} rejected round(s) not yet distilled into rules.`));
      }
    });

  withDomainOptions(rules.command('create').description('Write a rule by hand'))
    .requiredOption('--title <title>', 'The rule sentence')
    .option('--why <text>', 'Why it holds')
    .option('--how <text>', 'How to apply it')
    .option('--limits <text>', 'Where it stops applying')
    .option('--enforcement <enforcement>', `One of: ${EXPERTISE_ENFORCEMENTS.join(', ')}`)
    .option('--direction <direction>', `One of: ${EXPERTISE_RULE_DIRECTIONS.join(', ')}`)
    .option('--compilability <compilability>', `One of: ${COMPILABILITIES.join(', ')}`)
    .action(async (options: DomainOptions & Record<string, any>) => {
      assertChoice('--enforcement', options.enforcement, EXPERTISE_ENFORCEMENTS);
      assertChoice('--direction', options.direction, EXPERTISE_RULE_DIRECTIONS);
      assertChoice('--compilability', options.compilability, COMPILABILITIES);

      const client = await getTrpcClient();
      const domainId = await resolveSingleDomainId(client, options);
      const result = await client.expertise.createRule.mutate({
        compilability: options.compilability,
        direction: options.direction,
        domainId,
        enforcement: options.enforcement,
        how: options.how,
        limits: options.limits,
        title: options.title,
        why: options.why,
      });
      if (!result) fail(`Domain not found: ${domainId}`);
      console.log(`${pc.green('✓')} Created rule ${pc.bold(result.code)} (${result.id})`);
    });

  rules
    .command('update <lessonId>')
    .description('Edit a rule; wording edits are versioned, an empty section value clears it')
    .option('--title <title>', 'The rule title')
    .option('--rule <text>', 'The rule sentence')
    .option('--why <text>', 'Why it holds')
    .option('--how <text>', 'How to apply it')
    .option('--limits <text>', 'Where it stops applying')
    .option('--enforcement <enforcement>', `One of: ${EXPERTISE_ENFORCEMENTS.join(', ')}`)
    .option('--direction <direction>', `One of: ${EXPERTISE_RULE_DIRECTIONS.join(', ')}`)
    .option('--compilability <compilability>', `One of: ${COMPILABILITIES.join(', ')}`)
    .option('--reason-kind <kind>', `One of: ${REASON_KINDS.join(', ')}`)
    .action(async (lessonId: string, options: Record<string, any>) => {
      assertChoice('--enforcement', options.enforcement, EXPERTISE_ENFORCEMENTS);
      assertChoice('--direction', options.direction, EXPERTISE_RULE_DIRECTIONS);
      assertChoice('--compilability', options.compilability, COMPILABILITIES);
      assertChoice('--reason-kind', options.reasonKind, REASON_KINDS);

      // Only the flags given: the server treats a present section key as "replace this section".
      const sections: Record<string, string> = {};
      for (const key of ['rule', 'why', 'how', 'limits']) {
        if (options[key] !== undefined) sections[key] = options[key];
      }
      const patch = {
        ...(options.compilability && { compilability: options.compilability }),
        ...(options.direction && { direction: options.direction }),
        ...(options.enforcement && { enforcement: options.enforcement }),
        ...(options.reasonKind && { reasonKind: options.reasonKind }),
        ...(Object.keys(sections).length > 0 && { sections }),
        ...(options.title !== undefined && { title: options.title }),
      };
      if (Object.keys(patch).length === 0) fail('No changes specified.');

      const client = await getTrpcClient();
      const result = await client.expertise.updateRule.mutate({ lessonId, ...patch });
      if (!result) fail(`Rule not found: ${lessonId}`);
      console.log(`${pc.green('✓')} Updated rule ${pc.bold(lessonId)}`);
    });

  withDomainOptions(
    rules
      .command('reorder <lessonId>')
      .description('Move a rule within its group, to the end unless --before is given'),
  )
    .option('--before <lessonId>', 'Place it before this rule')
    .action(async (lessonId: string, options: DomainOptions & { before?: string }) => {
      const client = await getTrpcClient();
      const domainId = await resolveSingleDomainId(client, options);
      // The server files an unknown --before at the end and reports success, so check it first.
      if (options.before) {
        const target = await client.expertise.getLesson.query({ lessonId: options.before });
        if (target?.lesson.domainId !== domainId || target.lesson.status !== 'active') {
          fail(`--before ${options.before} is not an active rule of domain ${domainId}.`);
        }
      }
      const result = await client.expertise.reorderRule.mutate({
        beforeId: options.before ?? null,
        domainId,
        lessonId,
      });
      if (!result) fail(`Rule ${lessonId} is not an active rule of domain ${domainId}.`);
      console.log(`${pc.green('✓')} Reordered rule ${pc.bold(lessonId)}`);
    });

  withDomainOptions(
    rules
      .command('move <lessonId>')
      .description('File a rule under another group; a rule with evidence gets a new id'),
  ).action(async (lessonId: string, options: DomainOptions) => {
    const client = await getTrpcClient();
    const domainId = await resolveSingleDomainId(client, options);
    const result = await client.expertise.moveRule.mutate({ domainId, lessonId });
    if (!result) {
      fail(`Cannot move ${lessonId} to ${domainId}: it must be active and share the same reach.`);
    }
    console.log(`${pc.green('✓')} Moved rule, live id is ${pc.bold(result.id)}`);
  });

  rules
    .command('merge <fromId>')
    .description('Fold one rule into another; the source is retired with a pointer to the target')
    .requiredOption('--into <lessonId>', 'The rule that remains')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (fromId: string, options: { into: string; yes?: boolean }) => {
      if (!options.yes && !(await confirm(`Merge ${fromId} into ${options.into}?`))) {
        console.log('Cancelled.');
        return;
      }

      const client = await getTrpcClient();
      const result = await client.expertise.mergeRules.mutate({ fromId, intoId: options.into });
      if (!result) {
        fail('Cannot merge: the rules must be different, active and share the same reach.');
      }
      console.log(
        `${pc.green('✓')} Merged ${pc.bold(fromId)} into ${pc.bold(options.into)} (revision ${result.revision})`,
      );
    });

  // ── ingest-history ────────────────────────────────────

  withAgentOptions(
    expertise
      .command('ingest-history')
      .description("Learn from the agent's own past conversations in a background workflow"),
  )
    .option('--yes', 'Skip confirmation prompt')
    .action(async (options: AgentOptions & { yes?: boolean }) => {
      const client = await getTrpcClient();
      const { agentId, domains } = await listAgentDomains(client, options);
      // The workflow would run and learn nothing: ingestion needs a domain to file lessons in.
      if (domains.length === 0) fail('This agent has no expertise domains.');

      // Reading history spends model capacity, so the prompt states how much it would read.
      const { candidateCount } = await client.expertise.countHistory.query({ agentId });
      if (candidateCount === 0) {
        console.log('No past conversations to ingest.');
        return;
      }
      if (!options.yes && !(await confirm(`Read ${candidateCount} past conversation(s)?`))) {
        console.log('Cancelled.');
        return;
      }

      const result = await client.expertise.ingestHistory.mutate({ agentId });
      console.log(
        `${pc.green('✓')} Ingesting ${result.candidateCount} conversation(s)` +
          (result.workflowRunId ? ` (workflow: ${pc.bold(result.workflowRunId)})` : ''),
      );
    });
}
