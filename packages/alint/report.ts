/**
 * Publish an `alint --format json` run to GitHub:
 *
 * - an "ALint" check run on the head commit, red when any finding is at
 *   `error` level, with the findings attached as line annotations;
 * - one summary comment on the open pull request for the branch, rewritten in
 *   place on every push (created only once there is something to report);
 * - the same table in the job's step summary.
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
  execution?: { cached?: number; completed?: number; planned?: number };
  usage?: { totalTokens?: number };
}

export interface Finding {
  file: string;
  line: number;
  message: string;
  rule: string;
  severity: 'error' | 'warning';
  suggestion?: string;
}

export const COMMENT_MARKER = '<!-- alint-summary -->';
const FIXTURES_DIR = 'packages/alint/fixtures/';

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
    .filter((finding) => !finding.file.startsWith(FIXTURES_DIR))
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

/** Markdown body shared by the PR comment and the step summary. */
export const toMarkdown = (
  findings: Finding[],
  { repo, sha, runUrl }: { repo: string; runUrl?: string; sha: string },
): string => {
  const icon = findings.some((f) => f.severity === 'error') ? '❌' : findings.length ? '⚠️' : '✅';
  const lines = [`${COMMENT_MARKER}`, `### ${icon} ALint · ${toTitle(findings)}`, ''];
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
  lines.push('', `<sub>Commit \`${sha.slice(0, 7)}\`${runUrl ? ` · [run](${runUrl})` : ''}</sub>`);
  return lines.join('\n');
};

/** Check-run annotations; the API accepts at most 50 per request. */
export const toAnnotations = (findings: Finding[]) =>
  findings.slice(0, 50).map((finding) => ({
    annotation_level: finding.severity === 'error' ? 'failure' : 'warning',
    end_line: finding.line,
    message: finding.suggestion ? `${finding.message}\n\n${finding.suggestion}` : finding.message,
    path: finding.file,
    start_line: finding.line,
    title: finding.rule,
  }));

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

const upsertComment = async (repo: string, pr: number, body: string, hasFindings: boolean) => {
  const comments = (await api('GET', `/repos/${repo}/issues/${pr}/comments?per_page=100`)) as {
    body?: string;
    id: number;
  }[];
  const existing = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));
  if (existing) await api('PATCH', `/repos/${repo}/issues/comments/${existing.id}`, { body });
  else if (hasFindings) await api('POST', `/repos/${repo}/issues/${pr}/comments`, { body });
};

const main = async () => {
  const [inputPath] = process.argv.slice(2);
  if (!inputPath) {
    console.error('usage: bun packages/alint/report.ts <alint-output.json>');
    process.exit(2);
  }
  const findings = toFindings(
    JSON.parse(await readFile(inputPath, 'utf8')) as AlintOutput,
    process.cwd(),
  );
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const sha = process.env.HEAD_SHA ?? '';
  const markdown = toMarkdown(findings, { repo, runUrl: process.env.RUN_URL, sha });

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

  // The comment is a convenience; never let it fail the report.
  try {
    const pr = await findPullRequest(repo, process.env.HEAD_REF);
    if (pr) await upsertComment(repo, pr, markdown, findings.length > 0);
  } catch (error) {
    console.warn(`alint: could not update the PR comment: ${String(error)}`);
  }
};

if (import.meta.main) await main();
