#!/usr/bin/env node
// lobe-design state / feedback coverage checker (stage 70). Zero dependencies.
// Usage: node scripts/check-detail.mjs <path...> [--json]   (see --help)
// Per-file heuristics: "if the file does X, it must also handle Y". FAIL only for loading / error;
// everything else is WARN because it is a heuristic and may be handled in a parent component.
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ignores } from './lint-lobe.mjs';

const FETCH = /\b(useSWR\w*|useQuery|useInfiniteQuery|useRequest|useClientDataSWR|\.useQuery\(|fetch\(|axios\.|lambdaClient\.|trpc\.)/;
const LOADING = /\b(isLoading|loading|isFetching|isValidating|Skeleton|Spin|LoadingDots|pending|isPending)\b/;
const ERROR = /\b(error|isError|onError|catch\s*\(|ErrorBoundary|Result\b|Alert\b)/;
const RETRY = /\b(retry|refetch|mutate\(|reload|onRetry|重试|重新加载)/i;
const COLLECTION = /(\.map\(|<Table\b|<ProTable\b|<List\b|dataSource=)/;
const EMPTY = /(\bEmpty\b|length\s*===?\s*0|!\w+(\?\.)?\.length|isEmpty|emptyText|locale=\{\{\s*emptyText)/;
const ASYNC_HANDLER = /(on[A-Z]\w*=\{\s*async\b|const\s+handle\w*\s*=\s*async\b|useMutation|\.mutate(Async)?\()/;
const PENDING = /\b(loading=|isPending|isMutating|submitting|isSubmitting|setLoading|disabled=\{[^}]*(loading|pending|submitting))/i;
const RESULT_FEEDBACK = /\b(toast|message|notification)\.\w+\(|\bsetError\b|\bsetStatus\b|<Alert\b/;
const DISABLED = /\bdisabled=\{(?!\s*(loading|isLoading|pending|isPending|submitting|isSubmitting)\s*\})/;
const DISABLED_REASON = /(<Tooltip\b|\btitle=|disabledReason|aria-describedby)/;
const DANGER = /\b(handle|on)(Delete|Remove|Revoke|Destroy|Reset|Drop|Disable)\w*\b|danger\b/;
const CONFIRM = /\b(Popconfirm|confirm\(|modal\.confirm|useConfirm|ConfirmModal|Modal\b[^>]*danger|undo|撤销)/i;
const INPUT = /<(Input|TextArea|InputNumber|Select|input|textarea)\b/;
const LABEL = /(<Form\.Field\b|<FormField\b|\blabel=|aria-label=|aria-labelledby=|<label\b)/;

export const CHECKS = [
  { id: 'DETAIL-NO-LOADING', level: 'FAIL', ref: 'X-1.1', dim: '状态', when: FETCH, need: LOADING, msg: '有数据请求但没有加载态' },
  { id: 'DETAIL-NO-ERROR', level: 'FAIL', ref: 'X-1.2', dim: '状态', when: FETCH, need: ERROR, msg: '有数据请求但没有错误态' },
  { id: 'DETAIL-NO-RETRY', level: 'WARN', ref: 'X-1.2', dim: '状态', when: FETCH, need: RETRY, msg: '有数据请求但没有重试入口（retry / refetch / mutate）' },
  { id: 'DETAIL-NO-EMPTY', level: 'WARN', ref: 'X-1.3', dim: '状态', when: COLLECTION, need: EMPTY, msg: '渲染集合但没有空态分支' },
  { id: 'DETAIL-DISABLED-NO-REASON', level: 'WARN', ref: 'X-1.7', dim: '状态', when: DISABLED, need: DISABLED_REASON, msg: '有业务禁用态但没有说明原因（Tooltip / title / aria-describedby）' },
  { id: 'DETAIL-NO-PENDING', level: 'WARN', ref: 'X-3.1', dim: '交互反馈', when: ASYNC_HANDLER, need: PENDING, msg: '有异步动作但没有进行中 / 防重复提交状态' },
  { id: 'DETAIL-NO-RESULT-FEEDBACK', level: 'WARN', ref: 'X-3.2', dim: '交互反馈', when: ASYNC_HANDLER, need: RESULT_FEEDBACK, msg: '有异步动作但没有可见的成功 / 失败结果（toast / 行内状态）' },
  { id: 'DETAIL-DANGER-NO-CONFIRM', level: 'WARN', ref: 'X-3.3', dim: '交互反馈', when: DANGER, need: CONFIRM, msg: '有危险操作（删除 / 撤销 / 重置…）但没有二次确认或撤销' },
  { id: 'DETAIL-INPUT-NO-LABEL', level: 'WARN', ref: 'X-5.2', dim: '可访问性', when: INPUT, need: LABEL, msg: '有输入控件但文件内没有 label / Form.Field / aria-label' },
];

const HELP = `lobe-design check-detail — 体验细节覆盖检查（stage 70，零依赖）

逐文件做「做了 X 就必须处理 Y」的启发式判断：
${CHECKS.map((c) => `  ${c.level.padEnd(4)} ${c.id.padEnd(27)} ${c.ref.padEnd(6)} ${c.dim.padEnd(5)} ${c.msg}`).join('\n')}

用法
  node scripts/check-detail.mjs <文件或目录...> [--json]

退出码：0 无 FAIL · 1 有 FAIL · 2 用法错误
豁免：文件内写 // lobe-design-ignore DETAIL-NO-EMPTY: <理由>（例如空态由父组件处理）`;

const EXTS = new Set(['.tsx', '.jsx']);
// 与 lint-lobe 一致：遍历中遇到的软链目录跳过，避免重复扫描
function walk(p, out = [], top = true) {
  if (!top && lstatSync(p).isSymbolicLink() && statSync(p).isDirectory()) return out;
  const st = statSync(p);
  if (st.isDirectory()) { for (const n of readdirSync(p)) if (!['node_modules', '.git', 'dist', '.backup'].includes(n)) walk(join(p, n), out, false); }
  else if (EXTS.has(extname(p)) && !/\.(test|spec|stories)\.[jt]sx?$/.test(p)) out.push(p);
  return out;
}

// 豁免必须是注释里的 `lobe-design-ignore ID[,ID]: <理由>`；没写理由不生效（解析与 lint-lobe 共用）
const suppressedIds = (raw) => new Set(raw.split('\n').flatMap((l) => ignores(l).filter((g) => g.reason).flatMap((g) => g.ids)));

export function checkText(raw, file = '<text>') {
  const findings = [];
  const suppressed = suppressedIds(raw);
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const c of CHECKS) {
    if (suppressed.has(c.id)) continue;
    if (c.when.test(text) && !c.need.test(text)) findings.push({ file, id: c.id, level: c.level, ref: c.ref, dim: c.dim, msg: c.msg });
  }
  return findings;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) { console.log(HELP); process.exit(0); }
  const paths = args.filter((a) => !a.startsWith('-'));
  if (!paths.length) { console.error('用法错误：缺少目标路径。\n\n' + HELP); process.exit(2); }
  const missing = paths.filter((p) => !existsSync(p));
  if (missing.length) { console.error(`用法错误：路径不存在：${missing.join(', ')}`); process.exit(2); }
  const files = paths.flatMap((p) => walk(p));
  const findings = files.flatMap((f) => checkText(readFileSync(f, 'utf8'), f));
  const fail = findings.filter((f) => f.level === 'FAIL').length;
  if (args.includes('--json')) console.log(JSON.stringify(findings, null, 2));
  else {
    console.log(`LOBE-DESIGN · DETAIL   ${files.length} file(s)`);
    for (const f of findings) console.log(`  ${f.level} [${f.id}] ${relative(process.cwd(), f.file)}  → ${f.msg}（${f.ref} · ${f.dim} · 70-detail）`);
    console.log(`RESULT: ${fail} FAIL, ${findings.length - fail} WARN`);
  }
  process.exitCode = fail ? 1 : 0;
}
