import { MEETING_SEGMENT_SOURCES, MEETING_STATUSES } from '@lobechat/types';
import { type Command, Option } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { formatTimestamp, outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';

/** Offset within the recording as `m:ss`, or `h:mm:ss` from the first hour on. */
function formatOffset(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

function printSection(title: string, lines: string[]) {
  if (lines.length === 0) return;

  console.log();
  console.log(pc.bold(title));
  for (const line of lines) console.log(line);
}

function printMinutes(minutes: any) {
  printSection('Summary', minutes.summary ? [minutes.summary] : []);
  printSection(
    'Chapters',
    minutes.chapters.map(
      (chapter: any) => `  ${pc.dim(formatOffset(chapter.startMs))}  ${chapter.title}`,
    ),
  );
  printSection(
    'Decisions',
    minutes.decisions.map((decision: any) => `  - ${decision.text}`),
  );
  printSection(
    'Action items',
    minutes.actionItems.map((item: any) => {
      const owner = item.assigneeHint ? ` ${pc.dim(`@${item.assigneeHint}`)}` : '';
      const due = item.dueDate ? ` ${pc.dim(`due ${item.dueDate}`)}` : '';
      return `  - [${item.status}] ${item.text}${owner}${due}`;
    }),
  );
  printSection('Keywords', minutes.keywords.length > 0 ? [`  ${minutes.keywords.join(', ')}`] : []);
}

export function registerMeetingCommand(program: Command) {
  const meeting = program.command('meeting').description('Read recorded meetings');

  // ── list ──────────────────────────────────────────────

  meeting
    .command('list')
    .description('List meetings, newest first')
    .option('-L, --limit <n>', 'Page size (1-100)', '20')
    .option('--offset <n>', 'Number of meetings to skip', '0')
    .addOption(new Option('--status <status>', 'Filter by status').choices(MEETING_STATUSES))
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (options: {
        json?: string | boolean;
        limit: string;
        offset: string;
        status?: (typeof MEETING_STATUSES)[number];
      }) => {
        const limit = Number(options.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          log.error('--limit must be an integer between 1 and 100');
          process.exit(1);
          return;
        }

        const offset = Number(options.offset);
        if (!Number.isInteger(offset) || offset < 0) {
          log.error('--offset must be a non-negative integer');
          process.exit(1);
          return;
        }

        const client = await getTrpcClient();
        const { data: items } = (await client.meeting.list.query({
          limit,
          offset,
          status: options.status,
        })) as { data: any[] };

        if (options.json !== undefined) {
          outputJson(items, typeof options.json === 'string' ? options.json : undefined);
          return;
        }

        if (items.length === 0) {
          console.log('No meetings found.');
          return;
        }

        printTable(
          items.map((item) => [
            item.id,
            truncate(item.title, 40),
            item.status,
            item.durationMs === null ? '' : formatOffset(item.durationMs),
            timeAgo(item.startedAt),
          ]),
          ['ID', 'TITLE', 'STATUS', 'DURATION', 'STARTED'],
        );
      },
    );

  // ── view ──────────────────────────────────────────────

  meeting
    .command('view <id>')
    .description('View a meeting with its speakers, transcript and minutes')
    .addOption(
      new Option(
        '--source <source>',
        'Transcript to read (default: refined once available, else realtime)',
      ).choices(MEETING_SEGMENT_SOURCES),
    )
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (
        id: string,
        options: {
          json?: string | boolean;
          source?: (typeof MEETING_SEGMENT_SOURCES)[number];
        },
      ) => {
        const client = await getTrpcClient();
        const { data } = (await client.meeting.detail.query({
          id,
          source: options.source,
        })) as { data: any };

        if (options.json !== undefined) {
          outputJson(data, typeof options.json === 'string' ? options.json : undefined);
          return;
        }

        console.log(pc.bold(data.title));
        console.log(
          pc.dim(
            [
              data.id,
              data.status,
              formatTimestamp(data.startedAt),
              data.durationMs === null ? undefined : formatOffset(data.durationMs),
              data.language,
            ]
              .filter(Boolean)
              .join(' · '),
          ),
        );
        if (data.audio) console.log(pc.dim(`Audio: ${data.audio.url}`));
        else if (data.localAudioPath) console.log(pc.dim(`Audio: ${data.localAudioPath}`));

        if (data.minutes) printMinutes(data.minutes);

        const speakers = new Map<string, string>(
          data.speakers.map((speaker: any) => [speaker.id, speaker.displayName || speaker.label]),
        );
        printSection(
          `Transcript (${data.segmentSource})`,
          data.segments.map((segment: any) => {
            const speaker = speakers.get(segment.speakerId);
            return `${pc.dim(formatOffset(segment.startMs))}  ${speaker ? `${pc.cyan(speaker)}: ` : ''}${segment.text}`;
          }),
        );
      },
    );
}
