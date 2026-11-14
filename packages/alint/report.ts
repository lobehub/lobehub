/**
 * Publish an `alint --format json` run to GitHub:
 *
 * - an "ALint" check run on the head commit, red when any finding is at
 *   `error` level, with the findings attached as line annotations;
 * - one pull request review per PR: the summary body is rewritten in place on
 *   every push, plus a comment per finding on its own line, so it can be
 *   replied to and resolved where it was raised — files with more findings
 *   than AGGREGATE_THRESHOLD are commented once instead, to keep a run's
 *   request count bounded (created only once there is something to report);
 * - the same table in the job's step summary.
 *
 * The review is submitted as `COMMENT`: it informs, it does not block. The
 * ALint check is what turns red on errors.
 *
 * Every review comment costs a request, and GITHUB_TOKEN's budget is 1000
 * requests/hour shared by the whole repository, so the shape follows the real
 * numbers: a run finds a handful of findings spread over single lines (recent
 * PRs: 0 errors, <=4 warnings, one per file), which is cheap to comment per
 * line; a file that piles up findings is commented once instead.
 *
 * Calibration fixtures are dropped: bad fixtures fire by design and are
 * checked by the fixture suite instead.
 *
 *   bun packages/alint/report.ts alint-output.json
 *
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, HEAD_SHA, HEAD_REF (branch name),
 * PR_NUMBER (optional; looked up from HEAD_REF when absent), RUN_URL.
 */
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface AlintDiagnostic {
  evidence?: { suggestion?: unknown };
  filePath: string;
  loc?: { start?: { line?: number } };
  message: string;
  ruleId: string;
  severity: 'error' | 'warn';
}

export interface AlintOutput {
  diagnostics: AlintDiagnostic[];
  execution?: { cached?: number; completed?: number; failed?: number; planned?: number };
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * The cost of one run, carried in every summary so spend can be read back
 * from the check runs: model calls made, calls served from the cache, and
 * tokens sent and received.
 */
export const toUsageLine = ({ execution, usage }: AlintOutput): string | undefined => {
  if (!execution && !usage) return undefined;
  const calls = execution?.completed ?? 0;
  const cached = execution?.cached ?? 0;
  const input = usage?.inputTokens ?? 0;
  const output = usage?.outputTokens ?? 0;
  return `${calls} model calls, ${cached} cached · ${input.toLocaleString('en-US')} input / ${output.toLocaleString('en-US')} output tokens`;
};

export interface Finding {
  file: string;
  line: number;
  message: string;
  rule: string;
  severity: 'error' | 'warning';
  suggestion?: string;
}

/** Marks the review summarizing the run, so later pushes update it in place. */
export const REVIEW_MARKER = '<!-- alint-summary -->';

/**
 * Marks one inline comment and carries the key the next run looks it up by:
 * `file:line` for a per-line comment, `file` for a file aggregated because it
 * has too many findings.
 */
export const findingMarker = (key: string) => `<!-- alint-finding:${key} -->`;
const markerKey = (body?: string | null) => body?.match(/<!-- alint-finding:(.+?) -->/)?.[1];

/** Inline comments are capped like the annotations: 50 findings at most. */
const INLINE_LIMIT = 50;

/** A file with more findings than this gets one aggregated comment. */
export const AGGREGATE_THRESHOLD = 5;

/**
 * Calibration fixtures fire by design. Rules live in more than one place —
 * repo-wide rules in `packages/alint`, package-level rules next to their
 * package (`packages/<pkg>/alint`) — so match the fixtures directory of any.
 */
const isFixture = (file: string) => /^packages\/(?:[^/]+\/)?alint\/fixtures\//.test(file);

/** alint JSON → findings relative to the repo root, fixtures dropped, errors first. */
export const toFindings = (output: AlintOutput, rootDir: string): Finding[] =>
  output.diagnostics
    .map((diagnostic) => {
      const [message, ...rest] = diagnostic.message.split('\n');
      // Declarative rules put the fix in `evidence.suggestion`; hand-written
      // rules append a "Suggestion:" paragraph to the message instead.
      const fromEvidence = diagnostic.evidence?.suggestion;
      const suggestion =
        typeof fromEvidence === 'string' && fromEvidence.trim()
          ? fromEvidence.trim()
          : rest
              .join(' ')
              .replace(/^\s*Suggestion:\s*/i, '')
              .trim();
      return {
        file: path.relative(rootDir, diagnostic.filePath),
        line: diagnostic.loc?.start?.line ?? 1,
        message: message.trim(),
        rule: diagnostic.ruleId.replace(/^lobehub\//, ''),
        severity: diagnostic.severity === 'error' ? ('error' as const) : ('warning' as const),
        suggestion: suggestion || undefined,
      };
    })
    .filter((finding) => !isFixture(finding.file))
    .sort(
      (a, b) =>
        Number(b.severity === 'error') - Number(a.severity === 'error') ||
        a.file.localeCompare(b.file) ||
        a.line - b.line,
    );

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export const toTitle = (findings: Finding[]) => {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;
  if (findings.length === 0) return 'No findings on the changed lines';
  return [errors ? count(errors, 'error') : '', warnings ? count(warnings, 'warning') : '']
    .filter(Boolean)
    .join(', ');
};

const cell = (value: string) => value.replaceAll('|', '\\|').replaceAll('\n', ' ');
/** A list item is not a table cell: only newlines need collapsing there. */
const oneLine = (value: string) => value.replaceAll('\n', ' ');

/** Markdown body shared by the review and the step summary. */
export const toMarkdown = (
  findings: Finding[],
  { repo, sha, runUrl, usage }: { repo: string; runUrl?: string; sha: string; usage?: string },
): string => {
  const icon = findings.some((f) => f.severity === 'error') ? '❌' : findings.length ? '⚠️' : '✅';
  const lines = [`${REVIEW_MARKER}`, `### ${icon} ALint · ${toTitle(findings)}`, ''];
  if (findings.length === 0) {
    lines.push(`Checked the changed lines at \`${sha.slice(0, 7)}\`.`);
  } else {
    lines.push('| | Location | Rule | Finding |', '| --- | --- | --- | --- |');
    for (const finding of findings) {
      const link = `https://github.com/${repo}/blob/${sha}/${finding.file}#L${finding.line}`;
      const detail = finding.suggestion
        ? `${cell(finding.message)}<br><sub>💡 ${cell(finding.suggestion)}</sub>`
        : cell(finding.message);
      lines.push(
        `| ${finding.severity === 'error' ? '❌' : '⚠️'} | [\`${finding.file}:${finding.line}\`](${link}) | \`${finding.rule}\` | ${detail} |`,
      );
    }
    lines.push(
      '',
      'Errors fail the ALint check. Fix them, or explain in the PR why the rule does not apply. Rules live in `packages/alint/rules`.',
    );
  }
  lines.push(
    '',
    `<sub>Commit \`${sha.slice(0, 7)}\`${runUrl ? ` · [run](${runUrl})` : ''}${usage ? ` · ${usage}` : ''}</sub>`,
  );
  return lines.join('\n');
};

/** Check-run annotations; the API accepts at most 50 per request. */
export const toAnnotations = (findings: Finding[]) =>
  findings.slice(0, INLINE_LIMIT).map((finding) => ({
    annotation_level: finding.severity === 'error' ? 'failure' : 'warning',
    end_line: finding.line,
    message: finding.suggestion ? `${finding.message}\n\n${finding.suggestion}` : finding.message,
    path: finding.file,
    start_line: finding.line,
    title: finding.rule,
  }));

export interface FindingComment {
  body: string;
  key: string;
  line: number;
  path: string;
  side: 'RIGHT';
}

const severityIcon = (finding: Finding) => (finding.severity === 'error' ? '❌' : '⚠️');

const toFindingBody = (finding: Finding, key: string) =>
  [
    findingMarker(key),
    `**\`${finding.rule}\`** · ${finding.severity}`,
    '',
    oneLine(finding.message),
    ...(finding.suggestion ? ['', `💡 ${oneLine(finding.suggestion)}`] : []),
  ].join('\n');

const toAggregatedBody = (file: string, findings: Finding[]) =>
  [
    findingMarker(file),
    `**ALint · ${count(findings.length, 'finding')} in this file**`,
    '',
    ...findings.map((finding) => {
      const head = `- ${severityIcon(finding)} \`${finding.rule}\` · L${finding.line} — ${oneLine(finding.message)}`;
      return finding.suggestion ? `${head}\n  <sub>💡 ${oneLine(finding.suggestion)}</sub>` : head;
    }),
  ].join('\n');

/**
 * One comment per finding, on its own line, so the review reads like an
 * ESLint run. A file whose findings exceed AGGREGATE_THRESHOLD is commented
 * once instead: the point of the threshold is to keep the request count of a
 * runaway run bounded, not to hide lines that are cheap to annotate.
 */
export const toFindingComments = (findings: Finding[]): FindingComment[] => {
  const inline = findings.slice(0, INLINE_LIMIT);
  const groups = new Map<string, Finding[]>();
  for (const finding of inline) {
    const group = groups.get(finding.file);
    if (group) group.push(finding);
    else groups.set(finding.file, [finding]);
  }
  // Two rules can report the same line, so `file:line` is not always unique.
  // Count the collisions once, up front: a key that shifts between runs would
  // re-create a comment and leave the one for a fixed finding behind.
  const perLine = new Map<string, number>();
  for (const finding of inline) {
    const line = `${finding.file}:${finding.line}`;
    perLine.set(line, (perLine.get(line) ?? 0) + 1);
  }
  const keys = new Set<string>();
  const keyFor = (finding: Finding) => {
    const line = `${finding.file}:${finding.line}`;
    const base = (perLine.get(line) ?? 0) > 1 ? `${line}:${finding.rule}` : line;
    let key = base;
    // The same rule can still report the same line twice; order the repeats.
    for (let repeat = 2; keys.has(key); repeat += 1) key = `${base}#${repeat}`;
    keys.add(key);
    return key;
  };
  const comments: FindingComment[] = [];
  for (const [file, group] of groups) {
    if (group.length > AGGREGATE_THRESHOLD) {
      comments.push({
        body: toAggregatedBody(file, group),
        key: file,
        line: Math.min(...group.map((finding) => finding.line)),
        path: file,
        side: 'RIGHT',
      });
      continue;
    }
    for (const finding of group) {
      const key = keyFor(finding);
      comments.push({
        body: toFindingBody(finding, key),
        key,
        line: finding.line,
        path: file,
        side: 'RIGHT',
      });
    }
  }
  return comments;
};

export const toConclusion = (findings: Finding[]) =>
  findings.some((f) => f.severity === 'error')
    ? 'failure'
    : findings.length
      ? 'neutral'
      : 'success';

/* ------------------------------------------------------------------ GitHub */

const api = async (method: string, url: string, body?: unknown) => {
  const response = await fetch(`https://api.github.com${url}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    method,
  });
  if (!response.ok)
    throw new Error(`${method} ${url} → ${response.status} ${await response.text()}`);
  return response.status === 204 ? undefined : response.json();
};

/** Every page of a list endpoint: a PR can carry more than one page of comments. */
const apiPages = async <T>(url: string): Promise<T[]> => {
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    const batch = (await api(
      'GET',
      `${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
    )) as T[];
    items.push(...batch);
    if (batch.length < 100) return items;
  }
};

const findPullRequest = async (repo: string, branch?: string) => {
  if (process.env.PR_NUMBER) return Number(process.env.PR_NUMBER);
  if (!branch) return undefined;
  const owner = repo.split('/')[0];
  const pulls = (await api(
    'GET',
    `/repos/${repo}/pulls?state=open&head=${owner}:${encodeURIComponent(branch)}`,
  )) as { number: number }[];
  return pulls[0]?.number;
};

/** The review comments this script wrote on an earlier run, keyed by marker. */
const findFindingComments = async (repo: string, pr: number) => {
  const comments = await apiPages<{
    body?: string | null;
    id: number;
    line?: number | null;
  }>(`/repos/${repo}/pulls/${pr}/comments`);
  const byKey = new Map<string, { body?: string | null; id: number; line?: number | null }>();
  for (const comment of comments) {
    const key = markerKey(comment.body);
    if (key) byKey.set(key, comment);
  }
  return byKey;
};

/**
 * Keep the inline comments current across pushes. An identical body on an
 * unchanged line costs nothing, a changed body is edited in place (the thread
 * survives), and only a moved line is deleted and re-created. Comments for keys
 * this run no longer produces — a fixed finding, a file that dropped below the
 * aggregation threshold — are deleted.
 *
 * A line that is not part of the PR diff cannot carry a comment; the summary
 * table and the check annotation still carry that finding.
 */
const syncFindingComments = async (
  repo: string,
  pr: number,
  sha: string,
  findings: Finding[],
) => {
  const existing = await findFindingComments(repo, pr);
  const wanted = toFindingComments(findings);
  const target = new Set(wanted.map((comment) => comment.key));

  for (const [key, comment] of existing) {
    if (target.has(key)) continue;
    await api('DELETE', `/repos/${repo}/pulls/comments/${comment.id}`);
    existing.delete(key);
  }

  for (const comment of wanted) {
    const previous = existing.get(comment.key);
    try {
      if (previous && previous.line === comment.line) {
        if (previous.body !== comment.body)
          await api('PATCH', `/repos/${repo}/pulls/comments/${previous.id}`, {
            body: comment.body,
          });
        continue;
      }
      if (previous) await api('DELETE', `/repos/${repo}/pulls/comments/${previous.id}`);
      await api('POST', `/repos/${repo}/pulls/${pr}/comments`, {
        body: comment.body,
        commit_id: sha,
        line: comment.line,
        path: comment.path,
        side: comment.side,
      });
    } catch (error) {
      console.warn(`alint: no inline comment on ${comment.key}: ${String(error)}`);
    }
  }
};

/**
 * The summary used to be an issue comment on the PR. The first run under the
 * review shape retires it: the review replaces it, and leaving it behind would
 * keep a fixed finding's table visible — and, on a clean run, be the only ALint
 * message left on the PR.
 */
const retireLegacySummary = async (repo: string, pr: number) => {
  const comments = await apiPages<{ body?: string | null; id: number }>(
    `/repos/${repo}/issues/${pr}/comments`,
  );
  for (const comment of comments) {
    if (!comment.body?.includes(REVIEW_MARKER)) continue;
    try {
      await api('DELETE', `/repos/${repo}/issues/comments/${comment.id}`);
    } catch (error) {
      console.warn(`alint: could not retire the old summary comment: ${String(error)}`);
    }
  }
};

/**
 * Keep one review on the PR current across pushes. A submitted review cannot be
 * deleted or replaced, only edited, so its summary body is rewritten in place.
 */
const publishReview = async (
  repo: string,
  pr: number,
  sha: string,
  markdown: string,
  findings: Finding[],
) => {
  const reviews = await apiPages<{ body?: string | null; id: number }>(
    `/repos/${repo}/pulls/${pr}/reviews`,
  );
  const existing = [...reviews].reverse().find((review) => review.body?.includes(REVIEW_MARKER));

  if (existing) {
    if (existing.body !== markdown)
      await api('PUT', `/repos/${repo}/pulls/${pr}/reviews/${existing.id}`, { body: markdown });
  } else {
    // No review yet means this is the first run after the switch: drop the
    // summary comment the previous shape left on the PR.
    await retireLegacySummary(repo, pr);
    if (findings.length > 0)
      await api('POST', `/repos/${repo}/pulls/${pr}/reviews`, {
        body: markdown,
        commit_id: sha,
        event: 'COMMENT',
      });
  }

  await syncFindingComments(repo, pr, sha, findings);
};

const main = async () => {
  const [inputPath] = process.argv.slice(2);
  if (!inputPath) {
    console.error('usage: bun packages/alint/report.ts <alint-output.json>');
    process.exit(2);
  }
  const output = JSON.parse(await readFile(inputPath, 'utf8')) as AlintOutput;
  const findings = toFindings(output, process.cwd());
  const usage = toUsageLine(output);
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const sha = process.env.HEAD_SHA ?? '';
  const markdown = toMarkdown(findings, { repo, runUrl: process.env.RUN_URL, sha, usage });

  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  else console.info(markdown);

  if (!process.env.GITHUB_TOKEN || !repo || !sha) return;

  await api('POST', `/repos/${repo}/check-runs`, {
    conclusion: toConclusion(findings),
    head_sha: sha,
    name: 'ALint',
    output: { annotations: toAnnotations(findings), summary: markdown, title: toTitle(findings) },
    status: 'completed',
  });

  // The review is a convenience; never let it fail the report.
  try {
    const pr = await findPullRequest(repo, process.env.HEAD_REF);
    if (pr) await publishReview(repo, pr, sha, markdown, findings);
  } catch (error) {
    console.warn(`alint: could not publish the PR review: ${String(error)}`);
  }
};

if (import.meta.main) await main();
