const assert = require('node:assert/strict');
const { test } = require('node:test');

const { renderReceipts } = require('./render-budget-summary.cjs');

const pass = (direction) => ({
  direction,
  longFrameShare: 0.005,
  longFrames: 2,
  maxGapMs: 88.2,
  maxMountedRows: 24,
  p95GapMs: 16.7,
  rowMountsPerMessage: 0.9,
});

const receipt = (size, violations = [], passes = [pass('toTop'), pass('toBottom')]) => ({
  firstReadableMs: 1200,
  passes,
  size,
  violations,
});

test('lists every receipt by size with its measured values', () => {
  const markdown = renderReceipts([receipt(1000), receipt(500)]);

  const rows = markdown.split('\n').filter((line) => /^\| \d+ \|/.test(line));
  assert.deepEqual(
    rows.map((line) => line.split('|')[1].trim()),
    ['500', '500', '500', '1000', '1000', '1000'],
  );
  assert.match(markdown, /\| 500 \| open \| 1200 ms \|.*✅ \|/);
  assert.match(markdown, /\| 500 \| toTop \| \| 88.2 ms \| 16.7 ms \| 2 \(0.5%\) \| 24 \| 0.9 \|/);
  assert.doesNotMatch(markdown, /Over budget/);
});

test('marks a failing size and lists its violations', () => {
  const markdown = renderReceipts([receipt(500, ['scroll toTop max frame gap 900 ms > 800 ms'])]);

  assert.match(markdown, /\| 500 \| open \| 1200 ms \|.*❌ \|/);
  assert.match(markdown, /- scroll toTop max frame gap 900 ms > 800 ms/);
});

test('marks a scenario that stopped before both scroll passes as incomplete', () => {
  const markdown = renderReceipts([receipt(500, [], [pass('toTop')])]);

  assert.match(markdown, /\| 500 \| open \| 1200 ms \|.*⚠️ incomplete \|/);
});

test('says so when no receipt was written', () => {
  assert.match(renderReceipts([]), /No render budget receipts were written/);
});
