import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { StyleDifference } from './capture';
import type { runBoundaryMatrix, runHappyDomMatrix } from './matrix';

interface ComponentRun {
  backend: string;
  browserVersion: string;
  durationMs: number;
  generatedAt: string;
  provenance: {
    currentHead: string;
    dependencyFingerprint: string;
    installedVersions: Record<string, string>;
    preparationMs: number;
    revisions: Record<string, string>;
  };
  results: Array<{
    component: string;
    coverage: Array<{ branches: number; unwitnessed: unknown[]; witnessed: number }>;
    differenceCount: number;
    durationMs: number;
    id: string;
    results: Array<{
      differences: StyleDifference[];
      durationMs: number;
      id: string;
      propertyReads: number;
    }>;
    unsupported: string[];
  }>;
  runnerFingerprint: string;
  runtime: string;
}
interface Benchmark {
  cycles: Array<{
    domSnapshotSamples: Array<{ durationMs: number }>;
    engine: string;
    version: string;
  }>;
  runtime: string;
  summary: Array<{
    captureMedianMs: number;
    engine: string;
    launchMedianMs: number;
    rssMedianMiB: number;
  }>;
}
interface Inventory {
  branches: Array<{ ref: string; sha: string }>;
  kinds: Record<string, number>;
  legacyStyleSourceFiles: number;
  tiers: Record<string, number>;
  uniqueChangedTsFiles: number;
}
interface Reproduction {
  corrected: Array<{ id: string; renderingDifferences: StyleDifference[] }>;
  experimentalOverrideCss: string;
  independentControls: Array<{ differences: StyleDifference[]; fixture: string }>;
  original: Array<{ id: string; renderingDifferences: StyleDifference[] }>;
}
type Matrix = Awaited<ReturnType<typeof runBoundaryMatrix>> & {
  durationMs: number;
  engine: string;
  version: string;
};

const escape = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const cell = (values: unknown[]) =>
  `<tr>${values.map((value) => `<td>${escape(value)}</td>`).join('')}</tr>`;
const table = (headings: string[], rows: unknown[][]) =>
  `<table><thead><tr>${headings.map((heading) => `<th>${escape(heading)}</th>`).join('')}</tr></thead><tbody>${rows.map(cell).join('')}</tbody></table>`;
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const number = (value: number, digits = 1) => value.toFixed(digits);

const main = async () => {
  const output = path.resolve(process.argv[2] ?? '.records/stylex-migration-experiment/pilot');
  const read = async <T>(file: string): Promise<T> =>
    JSON.parse(await readFile(path.join(output, file), 'utf8'));
  const strict = await read<ComponentRun>('shell-results.json');
  const fast = await read<ComponentRun>('shell-fast-results.json');
  const chrome = await read<ComponentRun>('chrome-fast-results.json');
  const boundary = await read<Matrix>('boundaries/fast/shell.json');
  const chromeBoundary = await read<Matrix>('boundaries/fast/chrome.json');
  const strictBoundary = await read<Matrix>('boundaries/strict/shell.json');
  const happy = await read<ReturnType<typeof runHappyDomMatrix>>(
    'boundaries/strict/happy-dom.json',
  );
  const benchmark = await read<Benchmark>('benchmark.json');
  const inventory = await read<Inventory>('batch-inventory.json');
  const reproduction = await read<Reproduction>('reproduction.json');
  const parity = await read<{
    summary: { comparisons: number; differences: number; mismatching: number };
  }>('backend-parity.json');
  const parser = await read<{
    results: Array<{ inputBytes: number; samples: number[]; side: string }>;
    version: string;
  }>('parser.json');
  const builds = await read<Record<string, number>>('builds.json');
  const rendering = (fixture: ComponentRun['results'][number]) =>
    fixture.results
      .flatMap((probe) => probe.differences)
      .filter((difference) => !difference.diagnosticReason);
  const countProbes = (run: ComponentRun) =>
    run.results.reduce((sum, fixture) => sum + fixture.results.length, 0);
  const decisions = fast.results.map((fixture) => ({
    component: fixture.component,
    decision: rendering(fixture).length
      ? 'different'
      : fixture.unsupported.length ||
          fixture.coverage.some((coverage) => coverage.unwitnessed.length)
        ? 'feedback'
        : fixture.differenceCount
          ? 'diagnostics-only'
          : 'equal',
    fixture: fixture.id,
  }));
  const summary = {
    autoDecidableSynthetic:
      (boundary.summary.detected + boundary.summary.controlsEqual) / boundary.results.length,
    boundary: boundary.summary,
    componentCount: new Set(fast.results.map((fixture) => fixture.component)).size,
    decisions,
    fixtureCount: fast.results.length,
    generatedAt: new Date().toISOString(),
    host: {
      arch: process.arch,
      cpu: os.cpus()[0]?.model,
      node: fast.runtime,
      platform: process.platform,
    },
    independentAaDifferences: reproduction.independentControls.reduce(
      (sum, fixture) => sum + fixture.differences.length,
      0,
    ),
    independentAaFixtures: reproduction.independentControls.length,
    parity: parity.summary,
    probes: countProbes(fast),
    timings: {
      chromeFastMs: chrome.durationMs,
      shellFastMs: fast.durationMs,
      shellStrictMs: strict.durationMs,
      speedup: strict.durationMs / fast.durationMs,
    },
  };
  await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>StyleX 组件迁移验证实验</title>
<style>body{font:16px/1.7 system-ui,sans-serif;color:#222;max-width:1120px;margin:40px auto;padding:0 24px}table{border-collapse:collapse;width:100%;font-size:14px;margin:18px 0;display:block;overflow:auto}td,th{padding:7px 10px;border:1px solid #ccc;text-align:left;vertical-align:top}th{background:#f2f3f5}pre{background:#f2f3f5;padding:16px;overflow:auto;font-size:13px}code{font-size:.9em}h2{margin-top:40px}small{color:#555}a{color:#2357af}li{margin:6px 0}.result{border-left:4px solid #3860cf;padding:8px 20px;background:#f5f7ff}</style></head><body>
<h1>StyleX 组件迁移：验证方案与实验数据</h1><small>${escape(summary.generatedAt)} · ${escape(summary.host.platform)} ${escape(summary.host.arch)} · ${escape(summary.host.cpu)} · Node ${escape(fast.runtime)}</small>
<div class="result"><p>方案可行。建议使用 <strong>Node.js + 常驻 headless shell + CSSOM 条件发现 + CDP 批量样式树 + JS 补采</strong>。不需要 AI 逐组件截图，也不需要启动业务页面。保留完整 Chrome 作为兼容对照。</p>
<p>${summary.componentCount} 个真实组件、${summary.fixtureCount} 个夹具、${summary.probes} 个自动探针：全量 JS 读取 ${number(strict.durationMs / 1000)} 秒，混合采集 ${number(fast.durationMs / 1000)} 秒，实测 ${number(summary.timings.speedup)} 倍加速。自动发现了 LiteTable 的真实容器查询回归。</p>
<p>33 个刻意构造的边界用例：29 个缺陷中检出 ${boundary.summary.detected} 个，${boundary.summary.feedback} 个明确反馈；4 个等价迁移均未误报。样本自动判定率 ${number(summary.autoDecidableSynthetic * 100)}%。<strong>这不是全部迁移 PR 的覆盖率，也不是普遍缺陷检出率保证。</strong></p></div>

<h2>1. 实验范围与可信性</h2>
<p>真实源码来自 3 个迁移分支，对照基线为 stylex-foundation。两侧使用完全相同的当前已安装依赖、生产 Vite/StyleX 编译链与 UI 基础样式，仅替换导出的组件源码。夹具提供固定内容、尺寸和必要的 Provider；不做业务 props 组合穷举。样本含 StyleX 原子样式与复杂选择器的 CSS Modules 迁移。</p>
${table(['来源', '固定 revision'], Object.entries(fast.provenance.revisions))}
<p>依赖指纹：<code>${escape(fast.provenance.dependencyFingerprint)}</code>。实验运行器指纹见各 results.json。全部网络请求只允许本地夹具 origin；远程字体、图片和生产服务均不访问。字体使用固定本机字体环境。导出源码 ${number(fast.provenance.preparationMs)}ms，生产构建 before ${number(builds.before)}ms / after ${number(builds.after)}ms；不含首次安装浏览器。</p>
<p>${summary.independentAaFixtures} 个独立页面的 before/before 对照：${summary.independentAaDifferences} 个差异。另对混合采集与 JS 标准属性树做 ${parity.summary.comparisons} 次逐节点直接比对（前后两侧、容器边界、动画时刻）：${parity.summary.mismatching} 次不一致。哈希类名不参与 DOM 配对，动画名按 keyframes + timing 归一化。</p>

<h2>2. 轻量方案与性能</h2>
${table(
  [
    '运行方式',
    '新进程启动中位数',
    '两页进程 RSS 合计中位数',
    'JS 全量双树采集样本中位数',
    '浏览器版本',
  ],
  benchmark.summary.map((row) => [
    row.engine,
    `${number(row.launchMedianMs)}ms`,
    `${number(row.rssMedianMiB)}MiB`,
    `${number(row.captureMedianMs)}ms`,
    benchmark.cycles.find((cycle) => cycle.engine === row.engine)?.version,
  ]),
)}
<p>每引擎 3 次新进程启动，交替顺序；3 个真实组件各 5 次暖采样，合计每引擎 45 个双树样本。RSS 是浏览器自报进程的 ps RSS 求和，可能重复计算共享页，不是独占物理内存或峰值。机器已有磁盘缓存，不称作冷机启动。全量 Chrome 与 shell 的 patch 版本不同；迁移比较始终在同一引擎内部进行。</p>
${table(
  ['真实组件完整探针运行', '探针数', '耗时'],
  [
    [
      `shell / 全属性 JS（含自定义变量诊断）`,
      countProbes(strict),
      `${number(strict.durationMs / 1000)}s`,
    ],
    [
      'shell / 混合 CDP + JS（已解析标准属性）',
      countProbes(fast),
      `${number(fast.durationMs / 1000)}s`,
    ],
    ['Chrome / 同一混合采集', countProbes(chrome), `${number(chrome.durationMs / 1000)}s`],
  ],
)}
<p>原始 DOMSnapshot 单页调用中位约 ${number(median(benchmark.cycles.flatMap((cycle) => cycle.domSnapshotSamples.map((sample) => sample.durationMs))), 2)}ms。这仅是协议采样，不含探针切换、动画冻结、缺失节点补采、树构造与比较，不能直接冒充完整验证耗时。严格采集与混合采集也不是完全相同的原始属性集合：后者不直接采集自定义属性，但比较所有标准属性中已解析的消费者，并单独驱动已识别的 style query。</p>
<p>纯 Node 的 Happy DOM：${number(happy.durationMs)}ms，检出 ${happy.summary.changedDetected}/29，漏掉 ${happy.summary.changedMissed}/29，等价对照误报 ${happy.summary.falsePositive}/4；所有测试节点布局宽度均为 0。它很快，但不能担当这里的最终裁决器。Lightning CSS ${escape(parser.version)} 解析/压缩 ${parser.results.map((result) => `${number(result.inputBytes / 1024)}KiB 用时中位 ${number(median(result.samples), 2)}ms`).join(' / ')}；类名重命名会得到不同 CSS hash，不能将 AST/hash 相同问题等同于渲染等价证明。</p>

<h2>3. 边界与缺陷注入矩阵</h2>
<p>默认 computed tree 仅检出 ${strictBoundary.summary.defaultDetected}/29；规则驱动后检出 ${boundary.summary.detected}/29。Chrome 与 shell、严格与混合路径的已知用例判定一致（Chrome 混合：${chromeBoundary.summary.detected} 检出、${chromeBoundary.summary.feedback} 反馈、${chromeBoundary.summary.falsePositive} 误报）。不支持的 CSS Highlight 被显式标记，未算作通过。</p>
${table(
  ['用例', '预期', '默认树差异数', '规则驱动结果', '探针数', '反馈原因'],
  boundary.results.map((entry) => [
    entry.feature,
    entry.expected,
    entry.defaultDifferenceCount,
    entry.decision,
    entry.probeCount,
    entry.unsupported.join('; '),
  ]),
)}
<p>media/container 同时保留未生效规则，递归 CSSNestedDeclarations；尺寸断点采样 b−1、b、b+1，并对常见 media × container、条件 × hover 取有预算的交集。祖先、兄弟和 :has() 的 hover 触发对象纳入搜索。支持 ::before/::after/::marker/::placeholder、五种可强制交互伪类、简单字面量 style(--x:value) query，以及动画 keyframes/timing 与采样时刻。</p>
<p>额外植入不影响布局的私有 CSS marker 来确认发现的条件分支确实被激活；marker 不参与产品快照。未激活分支、解析失败、跨域 stylesheet、超探针预算都必须进入反馈。分支被激活一次不是所有条件笛卡尔积的形式证明。</p>

<h2>4. 真实组件结果</h2>
${table(
  ['组件/夹具', '探针', '混合耗时', '原始属性差异条次', '渲染相关差异条次', '未见证分支'],
  fast.results.map((entry) => [
    entry.id,
    entry.results.length,
    `${number(entry.durationMs)}ms`,
    entry.differenceCount,
    rendering(entry).length,
    entry.coverage.reduce((sum, coverage) => sum + coverage.unwitnessed.length, 0),
  ]),
)}
<p>“条次”包含同一问题在不同节点、逻辑/物理别名和多个探针中的重复，不等于缺陷数量。除 LiteTable 800px 分支外，其余夹具在已采样条件下只有零差异或可解释诊断；不声称其任意 DOM/内容/外部上下文都已证明等价。</p>
<p>严格原始树保留的诊断包括：display:flex 下不生效的旧 -webkit-box-* 属性；width:0 + style:none/hidden 的边框颜色；@property 注册后多出的变量默认值。所有原始值都保留，代码给出上下文原因，不通过粗暴忽略颜色/布局属性来“压低失败率”。自定义变量仅诊断意味着当前已解析消费者未变，不证明未挂载消费者或外部使用方不受影响。</p>

<h2>5. 实际发现：LiteTable 的层叠顺序回归</h2>
<p>来自 #21447 / stylex-components。默认 920px 与容器 600px、801px 没有渲染差异；在 601、799、800px，普通 metadata/actions 单元格 padding-block 从 6px 变成 8px，示例两行总高增加 16px；表格 min-width 从 0px 变成 max-content，hover 背景的覆盖顺序也改变。原因是 .wideList 与 .table 等特异性规则在 Emotion 注册顺序和导出的 CSS Modules 顺序间发生变化，不能仅照源码对象顺序复制。</p>
${table(
  ['复现条件', '原始渲染相关差异', '实验修正后'],
  reproduction.original.map((probe, index) => [
    probe.id,
    probe.renderingDifferences.length,
    reproduction.corrected[index]?.renderingDifferences.length,
  ]),
)}
<p>仅向实验 after 页面注入提高 wideList 覆盖优先级的 CSS，未编辑真实组件或 PR。7 个复现探针的渲染相关差异均降为 0；仍保留未生效旧 flex 属性的原始诊断。修正文本保存在 reproduction.json，可作为后续真实修复的依据，不代表生产修复已提交。</p>
<pre>${escape(reproduction.experimentalOverrideCss)}</pre>

<h2>6. 推广到这一批 PR 的可行方案</h2>
<p>对 ${inventory.branches.length} 个本地批次分支做了只读源码盘点：去重后的 ${inventory.uniqueChangedTsFiles} 个变更 TS/TSX 中，${inventory.legacyStyleSourceFiles} 个迁移前文件带 legacy style imports。现有启发式分类 A/B/C/D：${escape(JSON.stringify(inventory.tiers))}；含 pseudo ${inventory.kinds.pseudo}、media/container/supports ${inventory.kinds.media}、后代 ${inventory.kinds.descendant}、第三方/tag 选择器 ${inventory.kinds['third-party']}。这些是文件与特征计数，允许重叠，不是组件数、已迁移样式数或验证覆盖率。</p>
<ol><li>以迁移 PR + merge-base 为单元，固定依赖与构建配置，复用现有 story/测试 host 或一次性最小组件夹具；不需要整个业务页面。夹具用于挂载样式，不穷举业务行为。</li>
<li>对前后两侧 CSSOM 做并集发现，保留未激活规则、嵌套路径与选择器；从 CSS 自动生成交互、尺寸、方向、主题、reduced-motion 和动画探针，限制预算并记明缺口。</li>
<li>常驻一个 headless shell，隔离的 before/after 页面反复挂载组件；使用混合标准属性树 + 几何/滚动 + 常见伪元素 + 动画语义；需要原始变量诊断时回退严格路径。</li>
<li>输出 equal / diagnostics-only / different / feedback。只有已声明能力范围内的同构树和已见证条件才允许自动通过；different 可自动失败，feedback 绝不自动放行。</li>
<li>AI 只消费归并后的最小差异：组件、revision、DOM path、触发条件、属性前后值和源码位置；必要时再补该失败组件的局部截图。通过项不调用视觉 AI。</li></ol>
<p>建议下一轮以 100–200 个真实组件做分层盲测，按文件特征分层覆盖，统计自动可判定率、反馈率、稳定性和单位组件成本，再决定能否把 ≥95% 写进 CI 目标。目前证明的是原理、真实回归检出能力和可用的速度；不是全仓库达标。推广的主要工程量是夹具/Provider 自动复用、复杂选择器定位与条件规划，而非截图 token。</p>

<h2>7. 明确边界与运行经验</h2>
<p>未实现/应反馈：CSS Highlight/selection 与 UA 复杂伪元素、:visited 隐私样式、未激活的 checked/disabled/valid/open 等属性状态、Shadow DOM/adoptedStyleSheets、非 px/复杂二维/滚动 container query、复杂 style query、未支持的 media 特征、@scope/@starting-style、多元素同时伪类组合和超预算状态积。部分已显式检测，部分仍需完善静态能力扫描，现阶段不把此实验工具当成任意 CSS 的完备证书。</p>
<p>冻结动画并比较 keyframes/timing，不声称验证所有时间上的插值与 paint。只比较当前 DOM/资源/字体/浏览器契约内的样式；本实验不验证 Canvas/WebGL 绘制内容、图片/字体文件字节相同、跨浏览器排版或未挂载样式分支。跨域规则读取失败必须反馈。</p>
<p>实验中 Bun 驱动高频、大返回体 Playwright 采集曾出现等待不结束；改用 Node 运行同一编译后代码后，完整组件、矩阵和交替性能采样完成。尚未隔离到具体运行时缺陷，因此推荐 Node 作为浏览器控制进程，Bun 只构建夹具/转译工具。没有将运行时挂起误判成 CSS 通过。</p>

<h2>8. 复现、产物与社区依据</h2>
<pre>bun scripts/stylexMigration/experiment/run.ts --output .records/stylex-migration-experiment/recheck
# 已有构建可加 --reuse-build；需要本机 Chrome 与 Playwright headless shell
# 若尚未安装 shell：bunx playwright install chromium --only-shell</pre>
<p>入口：scripts/stylexMigration/experiment/run.ts。所有结果是本地 JSON/HTML，未上传、未修改 PR。浏览器和临时服务执行完即关闭，未使用已有用户浏览器配置。</p>
<p><a href="summary.json">汇总 JSON</a> · <a href="shell-fast-results.json">混合采集完整数据</a> · <a href="shell-results.json">严格采集完整数据</a> · <a href="boundaries/fast/shell.json">33 用例矩阵</a> · <a href="backend-parity.json">72 次采集一致性</a> · <a href="benchmark.json">性能样本</a> · <a href="reproduction.json">真实回归及修正实验</a> · <a href="batch-inventory.json">批次盘点</a> · <a href="provenance.json">来源与依赖</a></p>
<p>能力依据：<a href="https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/#method-captureSnapshot">CDP DOMSnapshot</a>、<a href="https://chromedevtools.github.io/devtools-protocol/tot/CSS/#method-forcePseudoState">CSS.forcePseudoState</a>、<a href="https://playwright.dev/docs/browsers#chromium-headless-shell">Playwright headless shell</a>。近似社区实践 <a href="https://github.com/BenSheridanEdwards/StyleProof">StyleProof</a>：本次未运行其实现，不作为性能或覆盖率证据。<a href="https://lightningcss.dev/">Lightning CSS</a> 是解析/转换基础设施，不是完整浏览器样式裁决器；<a href="https://github.com/DioxusLabs/blitz">Blitz</a> 本次未实测，不能据此宣称可替换浏览器内核。</p>
</body></html>`;
  await writeFile(path.join(output, 'report.html'), html);
  console.log(JSON.stringify(summary));
  console.log(`Report: ${path.join(output, 'report.html')}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
