/**
 * Render the long message list budget receipts (`e2e/reports/perf/*.json`,
 * written by `e2e/src/steps/performance/long-message-list.steps.ts`) as a
 * Markdown table for `$GITHUB_STEP_SUMMARY`, so every PR run shows the
 * measured values next to pass/fail, not only the failures.
 *
 * Usage: node .github/scripts/render-budget-summary.cjs <receipt-dir>
 */
const fs = require('node:fs');
const path = require('node:path');

const fmt = (value, unit = '') => (value === null || value === undefined ? '–' : `${value}${unit}`);

/** A scenario records both scroll passes when it runs to the end. */
const EXPECTED_PASSES = 2;

const resultOf = (receipt) => {
  if (receipt.violations.length > 0) return '❌';
  return receipt.passes.length < EXPECTED_PASSES ? '⚠️ incomplete' : '✅';
};

const renderReceipts = (receipts) => {
  if (receipts.length === 0)
    return '### Render budgets\n\nNo render budget receipts were written.\n';

  const lines = [
    '### Render budgets: long message list',
    '',
    '| Messages | Pass | First readable | Max frame gap | p95 gap | Long frames | Max mounted rows | Row mounts / msg | Result |',
    '| -------- | ---- | -------------- | ------------- | ------- | ----------- | ---------------- | ---------------- | ------ |',
  ];

  for (const receipt of receipts.toSorted((a, b) => a.size - b.size)) {
    const result = resultOf(receipt);
    lines.push(
      `| ${receipt.size} | open | ${fmt(receipt.firstReadableMs, ' ms')} | | | | | | ${result} |`,
    );
    for (const pass of receipt.passes) {
      lines.push(
        `| ${receipt.size} | ${pass.direction} | | ${fmt(pass.maxGapMs, ' ms')} | ${fmt(pass.p95GapMs, ' ms')} | ${fmt(pass.longFrames)}${pass.longFrameShare === undefined ? '' : ` (${Math.round(pass.longFrameShare * 1000) / 10}%)`} | ${fmt(pass.maxMountedRows)} | ${fmt(pass.rowMountsPerMessage)} | |`,
      );
    }
  }

  const violations = receipts.flatMap((receipt) => receipt.violations);
  if (violations.length > 0) {
    lines.push('', '**Over budget**', '', ...violations.map((violation) => `- ${violation}`));
  }

  return `${lines.join('\n')}\n`;
};

const readReceipts = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
};

module.exports = { readReceipts, renderReceipts };

if (require.main === module) {
  process.stdout.write(renderReceipts(readReceipts(process.argv[2] ?? 'e2e/reports/perf')));
}
