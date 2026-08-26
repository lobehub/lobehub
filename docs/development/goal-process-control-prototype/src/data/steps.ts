// One real Goal (tpc_XUh2GbVp3UVM, nanoGPT on M5 Max) replayed as a timeline. Each step mutates the
// state cumulatively; the page renders the state right after that moment.

import type { ActivityEvent, Edge, GoalNode, GoalState } from '../types';
import { clock, min } from '../model/format';

export const T0 = Date.parse('2026-08-26T00:52:00+08:00');
export const at = (m: number) => T0 + min(m);

const INITIAL = (): GoalState => ({
  goal: {
    id: 'GOAL-12',
    title: '复现 nanoGPT 本地训练（Shakespeare char，跑满 5000 iterations）',
    agent: 'Coding Agent',
    requirement:
      '在本机 MPS 上从零训练 nanoGPT Shakespeare char 至 5000 iterations；checkpoint 可用 torch.load 加载且 iter_num=5000；最终 validation loss ≤ 1.8 且相对初始下降 ≥ 30%；固定 seed 采样 ≥ 500 字符；summary.json 含命令、耗时、硬件、loss、SHA-256。',
    checks: [
      { label: '跑满 5000 iterations，checkpoint 可加载', state: 'pending' },
      { label: 'validation loss ≤ 1.8，且相对初始下降 ≥ 30%', state: 'pending' },
      { label: '固定 seed 采样 ≥ 500 字符', state: 'pending' },
    ],
    maxRounds: 10,
    maxTotalCost: 5,
    maxAttemptsPerWork: 3,
    leaseTimeoutMin: 5,
    startedAt: null,
    status: 'planning',
    spent: 0,
    lastActivity: null,
  },
  nodes: [
    { id: 'G', kind: 'goal', title: '复现 nanoGPT 本地训练', status: 'active' },
    {
      id: 'P1',
      kind: 'problem',
      title: '本机 MPS 能否支撑从零训练？',
      status: 'proposed',
      description: '训练前必须回答：Apple Silicon 上 PyTorch/MPS 是否可用、内存与磁盘是否足够。',
    },
    {
      id: 'W1',
      kind: 'work',
      ref: 'W-1',
      title: '获取源码并准备 Shakespeare 数据',
      status: 'proposed',
      cost: 0,
      attempts: [],
      priority: 2,
      description:
        'fresh clone nanoGPT，运行 data/shakespeare_char/prepare.py 生成 train.bin / val.bin；顺带做环境预检。',
    },
    {
      id: 'W5',
      kind: 'work',
      ref: 'W-2',
      title: '校准合理的 val loss 验收阈值',
      status: 'proposed',
      cost: 0,
      attempts: [],
      priority: 1,
      description:
        '查官方 train_shakespeare_char 基线与本机缩小配置的历史结果，给训练一个可审查的成功门槛。',
    },
    {
      id: 'W2',
      kind: 'work',
      ref: 'W-3',
      title: '从零训练 5000 iterations（MPS）',
      status: 'proposed',
      cost: 0,
      dependsOn: ['W1', 'W5'],
      attempts: [],
      description: '按验收契约训练并交付 checkpoint、完整 train.log、exit code 与 summary.json。',
    },
    {
      id: 'W3',
      kind: 'work',
      ref: 'W-5',
      title: '加载 checkpoint 并固定 seed 采样 500 字符',
      status: 'proposed',
      cost: 0,
      dependsOn: ['W2'],
      attempts: [],
    },
    {
      id: 'W4',
      kind: 'work',
      ref: 'W-6',
      title: '完成整体 Goal 验收',
      status: 'proposed',
      cost: 0,
      dependsOn: ['W3'],
      terminal: true,
      attempts: [],
    },
  ],
  edges: [
    ['G', 'P1', 'decomposes'],
    ['G', 'W1', 'decomposes'],
    ['G', 'W5', 'decomposes'],
    ['W1', 'P1', 'investigates'],
    ['W2', 'W1', 'depends_on'],
    ['W2', 'W5', 'depends_on'],
    ['W3', 'W2', 'depends_on'],
    ['W4', 'W3', 'depends_on'],
  ],
  decision: null,
  log: [],
});

const N = (s: GoalState, id: string) => s.nodes.find((n) => n.id === id)!;
const add = (s: GoalState, n: GoalNode) => {
  s.nodes.push(n);
  return n;
};
const edge = (s: GoalState, e: Edge) => s.edges.push(e);
const log = (s: GoalState, e: ActivityEvent) => s.log.push(e);

export interface Step {
  /** minutes since creation */
  t: number;
  label: string;
  note: string;
  fresh: string[];
  apply: (s: GoalState) => void;
}

export const STEPS: Step[] = [
  {
    t: 0,
    label: '创建 Goal，Agent 给出初始方案',
    note: '你写下目标、验收要求和预算。Agent 的第一轮把它拆成 1 个问题 + 5 项 Work 和依赖，这就是探索图的初始方案；开始前可以改。什么都还没派发。',
    fresh: ['G', 'P1', 'W1', 'W5', 'W2', 'W3', 'W4'],
    apply: (s) => {
      log(s, {
        t: at(0),
        kind: 'create',
        who: 'Agent',
        text: '根据目标生成初始方案：1 个问题、5 项 Work、4 条依赖',
        nodeId: 'G',
      });
    },
  },
  {
    t: 1,
    label: '开始执行',
    note: '第一次推进：挑出没有依赖、优先级最高的「获取源码」，为它创建负责人 Task（T-90）和 Work 级验收契约，交给 Kimi Code。',
    fresh: ['W1'],
    apply: (s) => {
      s.goal.status = 'running';
      s.goal.startedAt = at(1);
      s.goal.lastActivity = at(1);
      const w = N(s, 'W1');
      w.status = 'active';
      w.task = { id: 'T-90', agent: 'Kimi Code' };
      w.lastActivity = at(1);
      w.lastLine = '正在准备工作目录 .records/nanogpt-full…';
      log(s, { t: at(1), kind: 'resume', who: '你', text: '开始执行' });
      log(s, {
        t: at(1),
        kind: 'start',
        who: '系统',
        text: '派发第 1 次尝试给 Kimi Code（T-90）',
        nodeId: 'W1',
      });
    },
  },
  {
    t: 4,
    label: '执行中',
    note: 'builder 在 Task 里干活；runtime 每 90 秒续一次租约。行上的"最近：…"来自 T-90 会话里最后一条工具输出，"3 分钟前"来自它的心跳。',
    fresh: [],
    apply: (s) => {
      const w = N(s, 'W1');
      w.lastActivity = at(3);
      w.lastLine =
        'git clone https://github.com/karpathy/nanoGPT && python data/shakespeare_char/prepare.py';
      s.goal.lastActivity = at(3);
      s.goal.spent = 0.06;
    },
  },
  {
    t: 7,
    label: '通过 → 两条结论 → 下一项开始',
    note: 'builder 交付，独立 verifier 判定通过。这次尝试产出两条结论：环境预检回答了「本机能否训练」，数据准备完成。同一次推进里，下一项「校准阈值」立刻开始。',
    fresh: ['F1', 'F2', 'W5'],
    apply: (s) => {
      const w = N(s, 'W1');
      w.status = 'resolved';
      w.cost = 0.12;
      w.at = at(7);
      w.lastLine = undefined;
      w.attempts!.push({
        n: 1,
        started: at(1),
        ended: at(7),
        outcome: 'passed',
        cost: 0.12,
        reason: 'fresh clone 3adf61e，train.bin / val.bin 已生成；环境预检通过',
        taskId: 'T-90',
      });
      N(s, 'P1').status = 'resolved';
      add(s, {
        id: 'F1',
        kind: 'finding',
        title: 'M5 Max · 128 GB · PyTorch 2.8 · MPS 可用',
        status: 'resolved',
        at: at(7),
        from: 'W1',
        body: '环境预检通过：Apple M5 Max、128 GB 内存、PyTorch 2.8，MPS 可用，磁盘余量 3.1 TB。回答了「本机 MPS 能否支撑从零训练？」。',
      });
      edge(s, ['W1', 'F1', 'produces']);
      edge(s, ['F1', 'P1', 'supports']);
      add(s, {
        id: 'F2',
        kind: 'finding',
        title: 'fresh clone 3adf61e，数据 1.0M tokens',
        status: 'resolved',
        at: at(7),
        from: 'W1',
        body: 'nanoGPT commit 3adf61e154c3；Shakespeare char 数据 train 1,003,854 / val 111,540 tokens。',
      });
      edge(s, ['W1', 'F2', 'produces']);
      log(s, {
        t: at(7),
        kind: 'pass',
        who: 'verifier',
        text: '第 1 次尝试通过',
        nodeId: 'W1',
        detail: 'fresh clone 3adf61e，train.bin / val.bin 已生成；环境预检通过',
      });
      log(s, { t: at(7), kind: 'finding', who: '系统', text: '沉淀结论', nodeId: 'F1' });
      log(s, { t: at(7), kind: 'finding', who: '系统', text: '沉淀结论', nodeId: 'F2' });
      const w5 = N(s, 'W5');
      w5.status = 'active';
      w5.task = { id: 'T-91', agent: 'Kimi Code' };
      w5.lastActivity = at(7);
      w5.lastLine = '检索 nanoGPT README 与 train_shakespeare_char 的公开基线…';
      log(s, {
        t: at(7),
        kind: 'start',
        who: '系统',
        text: '派发第 1 次尝试给 Kimi Code（T-91）',
        nodeId: 'W5',
      });
      s.goal.spent = 0.12;
      s.goal.lastActivity = at(7);
    },
  },
  {
    t: 14,
    label: 'Agent 自己做了一个决策 → 训练开始',
    note: '结论：官方基线 ≈ 1.47，"loss 下降"不是有效门槛。这是 Agent 权限内的决策（authority: agent）：把 ≤ 1.8 写进训练的验收契约，并顺手加了一项「写复现说明」。训练的两个依赖都满足了，同一次推进里立刻开始。',
    fresh: ['F5', 'D0', 'W2', 'W6'],
    apply: (s) => {
      const w = N(s, 'W5');
      w.status = 'resolved';
      w.cost = 0.08;
      w.at = at(14);
      w.lastLine = undefined;
      w.attempts!.push({
        n: 1,
        started: at(7),
        ended: at(14),
        outcome: 'passed',
        cost: 0.08,
        reason: '查到官方 char 配置基线与本机缩小配置的历史结果',
        taskId: 'T-91',
      });
      add(s, {
        id: 'F5',
        kind: 'finding',
        title: '官方 char 配置 val loss ≈ 1.47；"loss 下降"不是有效门槛',
        status: 'resolved',
        at: at(14),
        from: 'W5',
        body: '官方 train_shakespeare_char 在 GPU 上 5000 iter 约 1.47；0.8M 参数 500 iter 只到 2.33。仅要求 "低于初始值" 会让验收几乎必过。',
      });
      edge(s, ['W5', 'F5', 'produces']);
      add(s, {
        id: 'D0',
        kind: 'decision',
        subtype: 'gate',
        title: '验收阈值定为 ≤ 1.8 且降幅 ≥ 30%',
        status: 'resolved',
        authority: 'agent',
        at: at(14),
        body: 'Agent 基于 F5 自行决定（authority: agent，无需人介入）：把 "loss 下降" 改为绝对阈值 ≤ 1.8 + 相对降幅 ≥ 30%，写入 W-3 的验收契约；并追加一项「写训练复现说明」。',
      });
      edge(s, ['F5', 'D0', 'leads_to']);
      edge(s, ['D0', 'W2', 'leads_to']);
      add(s, {
        id: 'W6',
        kind: 'work',
        ref: 'W-4',
        title: '写训练复现说明（命令 + 硬件 + 耗时）',
        status: 'proposed',
        cost: 0,
        attempts: [],
        description: '把命令、硬件、耗时、SHA-256 写进 README，便于复现。',
      });
      edge(s, ['D0', 'W6', 'leads_to']);
      log(s, {
        t: at(14),
        kind: 'pass',
        who: 'verifier',
        text: '第 1 次尝试通过',
        nodeId: 'W5',
        detail: '查到官方 char 配置基线与本机缩小配置的历史结果',
      });
      log(s, { t: at(14), kind: 'finding', who: '系统', text: '沉淀结论', nodeId: 'F5' });
      log(s, {
        t: at(14),
        kind: 'decision',
        who: 'Agent',
        text: '决策：验收阈值定为 ≤ 1.8 且降幅 ≥ 30%；新增 Work「写训练复现说明」',
        nodeId: 'D0',
      });
      const w2 = N(s, 'W2');
      w2.status = 'active';
      w2.task = { id: 'T-94', agent: 'Kimi Code' };
      w2.lastActivity = at(14);
      w2.lastLine =
        '执行 python3 train.py config/train_shakespeare_char.py --device=mps --max_iters=5000 …';
      log(s, {
        t: at(14),
        kind: 'start',
        who: '系统',
        text: '派发第 1 次尝试给 Kimi Code（T-94）',
        nodeId: 'W2',
      });
      s.goal.spent = 0.2;
      s.goal.lastActivity = at(14);
    },
  },
  {
    t: 35,
    label: '训练中',
    note: '20 分钟过去。你回来看：还在动（2 分钟前写了新 checkpoint），val loss 已到 1.52。「写复现说明」排在后面——coordinator 一次只派一项。没有需要你做的。',
    fresh: [],
    apply: (s) => {
      const w = N(s, 'W2');
      w.lastActivity = at(33);
      w.lastLine = 'step 1000: train loss 1.61, val loss 1.52 · 已写入 checkpoint（iter_num=1000）';
      s.goal.lastActivity = at(33);
      s.goal.spent = 0.7;
      log(s, {
        t: at(33),
        kind: 'progress',
        who: 'Kimi Code',
        text: 'step 1000：val loss 1.52，已写入 checkpoint',
        nodeId: 'W2',
      });
    },
  },
  {
    t: 82,
    label: '失联',
    note: '真实发生过：执行它的 Agent 进程随会话一起没了，但本机训练进程还在跑。47 分钟没有心跳——页面不能再显示"运行中"的 spinner，要说"失联"。',
    fresh: ['W2'],
    apply: (s) => {
      const w = N(s, 'W2');
      w.lastLine = '（47 分钟没有新的心跳；本机 train.py 仍在运行）';
      s.goal.spent = 0.91;
    },
  },
  {
    t: 83,
    label: '系统回收并重开',
    note: '下一次推进把第 1 次尝试标为失联（计费、不计失败次数），自动开第 2 次；新 Agent 被要求审计已经跑完的 checkpoint，不要重训。没有找你。',
    fresh: ['W2'],
    apply: (s) => {
      const w = N(s, 'W2');
      w.attempts!.push({
        n: 1,
        started: at(14),
        ended: at(83),
        outcome: 'abandoned',
        cost: 0.91,
        reason: '执行 Agent 失联，由系统回收；训练进程已自行跑完 5000 iter',
        taskId: 'T-94',
      });
      w.cost = 0.91;
      w.lastActivity = at(83);
      w.lastLine = '审计静止 checkpoint：iter_num=5000，val loss 1.7119；补写 summary.json…';
      s.goal.lastActivity = at(83);
      log(s, {
        t: at(83),
        kind: 'abandon',
        who: '系统',
        text: '第 1 次尝试失联 47 分钟，已回收（不计失败次数）',
        nodeId: 'W2',
      });
      log(s, {
        t: at(83),
        kind: 'start',
        who: '系统',
        text: '自动重开：第 2 次尝试（T-94，Kimi Code）',
        nodeId: 'W2',
      });
    },
  },
  {
    t: 95,
    label: '未通过，自动再试',
    note: 'verifier 拒绝：train.log 只有 6/21 个 eval 点、exit code 没抓到。还有次数和预算，系统自动开第 3 次，把 verifier 的缺口反馈带进指令——没有找你。',
    fresh: ['W2'],
    apply: (s) => {
      const w = N(s, 'W2');
      w.attempts!.push({
        n: 2,
        started: at(83),
        ended: at(95),
        outcome: 'failed',
        cost: 0.61,
        reason:
          'train.log 只保留 6/21 个 eval 点，缺少 iter 1500–5000 的原始记录；训练进程 exit code 未捕获',
        taskId: 'T-94',
      });
      w.cost = 1.52;
      w.lastActivity = at(95);
      w.lastLine = '第 3 次尝试：重新完整训练以补齐完整 train.log…';
      s.goal.spent = 1.52;
      s.goal.lastActivity = at(95);
      log(s, {
        t: at(95),
        kind: 'fail',
        who: 'verifier',
        text: '第 2 次尝试未通过',
        nodeId: 'W2',
        detail: 'train.log 只保留 6/21 个 eval 点；exit code 未捕获',
      });
      log(s, {
        t: at(95),
        kind: 'start',
        who: '系统',
        text: '自动重试：第 3 次尝试，携带 verifier 的缺口反馈',
        nodeId: 'W2',
      });
    },
  },
  {
    t: 100,
    label: '预算用完，停下来问你',
    note: '第 3 次尝试选择了重训，费用越过 $5 上限。系统停下不再开始新尝试，来问你。这不是一个新节点：预算是针对正在跑的这项 Work 的人工介入，之后会记在它身上。',
    fresh: ['W2'],
    apply: (s) => {
      const w = N(s, 'W2');
      w.cost = 4.9;
      w.lastActivity = at(100);
      s.goal.spent = 5.02;
      s.goal.status = 'paused';
      s.goal.pauseCause = 'cost';
      s.goal.lastActivity = at(100);
      log(s, {
        t: at(100),
        kind: 'pause',
        who: '系统',
        text: '费用 $5.02 超过上限 $5.00，已暂停：不再开始新的尝试',
        nodeId: 'W2',
      });
    },
  },
  {
    t: 101,
    label: '你追加预算',
    note: '你把上限调到 $10 并继续；当前尝试接着跑。「从零训练」这个 Work 从此带上"你"角标——有人参与过。',
    fresh: ['W2'],
    apply: (s) => {
      s.goal.maxTotalCost = 10;
      s.goal.status = 'running';
      s.goal.pauseCause = undefined;
      s.goal.lastActivity = at(101);
      const w = N(s, 'W2');
      w.humanTouches = [
        ...(w.humanTouches ?? []),
        { t: at(101), kind: 'budget', text: '预算 $5 → $10，继续' },
      ];
      w.lastLine = '重训完成；提交 summary.json 与 checkpoint SHA-256…';
      w.lastActivity = at(101);
      log(s, {
        t: at(101),
        kind: 'budget',
        who: '你',
        text: '费用上限调整为 $10.00，继续',
        nodeId: 'W2',
      });
    },
  },
  {
    t: 108,
    label: '第二次拒绝 → 决策门',
    note: '第 3 次仍然只补了 summary、没有举证日志。单项尝试次数用完，系统不再自动重试，开一道决策门：证据 + 两个选项 + 各自后果 + 推荐。这是图上一个橙色的"你"节点。',
    fresh: ['D1'],
    apply: (s) => {
      const w = N(s, 'W2');
      w.attempts!.push({
        n: 3,
        started: at(95),
        ended: at(108),
        outcome: 'failed',
        cost: 3.38,
        reason: '重新训练后仍只补交 summary.json；日志缺口未举证，verifier 判定证据不可审计',
        taskId: 'T-94',
      });
      w.status = 'waiting';
      w.lastActivity = at(108);
      w.lastLine = undefined;
      w.cost = 4.9;
      s.goal.spent = 5.4;
      s.goal.status = 'review';
      s.goal.lastActivity = at(108);
      add(s, {
        id: 'D1',
        kind: 'decision',
        subtype: 'gate',
        title: '训练已两次未通过验证，怎么继续？',
        status: 'waiting',
        authority: 'user',
        at: at(108),
      });
      edge(s, ['W2', 'D1', 'leads_to']);
      s.decision = {
        id: 'd1',
        nodeId: 'D1',
        workId: 'W2',
        why: '两次 verifier 判定都指向同一缺口：train.log 只保留了 21 个 eval 点中的 6 个，缺少 iter 1500–5000 的原始记录；exit code 未捕获。模型本身已训练到 iter 5000，静止 checkpoint val loss 1.7119（≤ 1.8）。',
        options: [
          {
            id: 'retry',
            label: '再试一次',
            consequence: '开始第 4 次尝试，把缺口反馈和你的说明写进指令；预计再花约 $0.6。',
          },
          {
            id: 'retire',
            label: '放弃这项 Work',
            consequence:
              '标为已放弃；依赖它的「采样」和「整体验收」无法继续，Goal 很可能以失败结束。',
          },
        ],
        recommended: 'retry',
      };
      log(s, {
        t: at(108),
        kind: 'fail',
        who: 'verifier',
        text: '第 3 次尝试未通过',
        nodeId: 'W2',
        detail: '重新训练后仍只补交 summary.json；日志缺口未举证',
      });
      log(s, {
        t: at(108),
        kind: 'decision',
        who: '系统',
        text: '单项尝试次数用完，开决策门等你',
        nodeId: 'D1',
      });
    },
  },
  {
    t: 110,
    label: '你决定：再试一次',
    note: '你选了推荐项，并补了一句"不要重训，基于静止 checkpoint 补齐 train.log 缺口"。决策变成实心橙节点，第 4 次尝试带着你的话开始。',
    fresh: ['D1', 'W2'],
    apply: (s) => {
      const d = N(s, 'D1');
      d.status = 'resolved';
      d.title = '训练两次未通过 → 再试一次';
      d.body =
        '你选择了「再试一次」，并附说明：不要重训，基于静止 checkpoint 补齐 train.log 缺口。';
      d.at = at(110);
      s.decision = null;
      const w = N(s, 'W2');
      w.status = 'active';
      w.lastActivity = at(110);
      w.lastLine = '按你的说明：从静止 checkpoint 与训练日志重建 21 个 eval 点，捕获 exit code…';
      w.humanTouches = [
        ...(w.humanTouches ?? []),
        {
          t: at(110),
          kind: 'retry',
          text: '决策门：再试一次 — "不要重训，基于静止 checkpoint 补齐 train.log 缺口"',
        },
      ];
      s.goal.status = 'running';
      s.goal.lastActivity = at(110);
      log(s, {
        t: at(110),
        kind: 'decision',
        who: '你',
        text: '决定：再试一次 — "不要重训，基于静止 checkpoint 补齐 train.log 缺口"',
        nodeId: 'D1',
      });
      log(s, {
        t: at(110),
        kind: 'start',
        who: '系统',
        text: '第 4 次尝试开始（T-94，Kimi Code）',
        nodeId: 'W2',
      });
    },
  },
  {
    t: 126,
    label: '通过 → 结论 → 采样开始',
    note: '第 4 次交付了完整的 21/21 eval 记录和 exit code 0，verifier 通过。训练完成、沉淀结论；「采样」解锁并立刻开始。',
    fresh: ['F3', 'W3'],
    apply: (s) => {
      const w = N(s, 'W2');
      w.attempts!.push({
        n: 4,
        started: at(110),
        ended: at(126),
        outcome: 'passed',
        cost: 0.58,
        reason: '完整 train.log 21/21 eval 点；exit code 0；ckpt SHA-256 5eeedcc7…',
        taskId: 'T-94',
      });
      w.status = 'resolved';
      w.cost = 5.48;
      w.at = at(126);
      w.lastLine = undefined;
      add(s, {
        id: 'F3',
        kind: 'finding',
        title: '5000 iter 完成，val loss 1.7119，checkpoint 可加载',
        status: 'resolved',
        at: at(126),
        from: 'W2',
        body: '最终 checkpoint iter_num=5000，val loss 1.7119（相对初始 4.28 下降 60%），123 MB，torch.load 成功。',
      });
      edge(s, ['W2', 'F3', 'produces']);
      log(s, {
        t: at(126),
        kind: 'pass',
        who: 'verifier',
        text: '第 4 次尝试通过',
        nodeId: 'W2',
        detail: '完整 train.log 21/21 eval 点；exit code 0',
      });
      log(s, { t: at(126), kind: 'finding', who: '系统', text: '沉淀结论', nodeId: 'F3' });
      const w3 = N(s, 'W3');
      w3.status = 'active';
      w3.task = { id: 'T-96', agent: 'Kimi Code' };
      w3.lastActivity = at(126);
      w3.lastLine =
        'torch.load(ckpt.pt) → sample.py --seed=1337 --num_samples=1 --max_new_tokens=500';
      log(s, {
        t: at(126),
        kind: 'start',
        who: '系统',
        text: '派发第 1 次尝试给 Kimi Code（T-96）',
        nodeId: 'W3',
      });
      s.goal.spent = 6.0;
      s.goal.lastActivity = at(126);
    },
  },
  {
    t: 134,
    label: '采样通过 → 说明文档开始',
    note: '固定 seed 采样 635 字符，通过。最后一项原始 Work「写复现说明」开始。',
    fresh: ['F4', 'W6'],
    apply: (s) => {
      const w3 = N(s, 'W3');
      w3.status = 'resolved';
      w3.cost = 0.09;
      w3.at = at(134);
      w3.lastLine = undefined;
      w3.attempts!.push({
        n: 1,
        started: at(126),
        ended: at(134),
        outcome: 'passed',
        cost: 0.09,
        reason: '固定 seed 采样 635 个非空白字符',
        taskId: 'T-96',
      });
      add(s, {
        id: 'F4',
        kind: 'finding',
        title: '固定 seed 采样 635 字符，Shakespeare 风格',
        status: 'resolved',
        at: at(134),
        from: 'W3',
        body: '采样输出 SHA-256 951a2d97…；非空白字符 635。',
      });
      edge(s, ['W3', 'F4', 'produces']);
      log(s, {
        t: at(134),
        kind: 'pass',
        who: 'verifier',
        text: '第 1 次尝试通过',
        nodeId: 'W3',
        detail: '固定 seed 采样 635 个非空白字符',
      });
      log(s, { t: at(134), kind: 'finding', who: '系统', text: '沉淀结论', nodeId: 'F4' });
      const w6 = N(s, 'W6');
      w6.status = 'active';
      w6.task = { id: 'T-97', agent: 'Kimi Code' };
      w6.lastActivity = at(134);
      w6.lastLine = '写入 README：命令、硬件（M5 Max/MPS）、耗时 58 min、SHA-256…';
      log(s, {
        t: at(134),
        kind: 'start',
        who: '系统',
        text: '派发第 1 次尝试给 Kimi Code（T-97）',
        nodeId: 'W6',
      });
      s.goal.spent = 6.09;
      s.goal.lastActivity = at(134);
    },
  },
  {
    t: 141,
    label: '所有 Work 完成 → 整体验收开始',
    note: 'README 通过。所有原始 Work 终态后，系统生成最后一项「完成整体 Goal 验收」，用完整的目标要求做契约，由独立 verifier 复验全部产物。',
    fresh: ['F6', 'W4'],
    apply: (s) => {
      const w6 = N(s, 'W6');
      w6.status = 'resolved';
      w6.cost = 0.04;
      w6.at = at(140);
      w6.lastLine = undefined;
      w6.attempts!.push({
        n: 1,
        started: at(134),
        ended: at(140),
        outcome: 'passed',
        cost: 0.04,
        reason: 'README 含命令、硬件、耗时与 SHA-256',
        taskId: 'T-97',
      });
      add(s, {
        id: 'F6',
        kind: 'finding',
        title: '复现说明已写入 README',
        status: 'resolved',
        at: at(140),
        from: 'W6',
        body: '命令、硬件、耗时、SHA-256 齐全。',
      });
      edge(s, ['W6', 'F6', 'produces']);
      log(s, {
        t: at(140),
        kind: 'pass',
        who: 'verifier',
        text: '第 1 次尝试通过',
        nodeId: 'W6',
        detail: 'README 含命令、硬件、耗时与 SHA-256',
      });
      log(s, { t: at(140), kind: 'finding', who: '系统', text: '沉淀结论', nodeId: 'F6' });
      const w4 = N(s, 'W4');
      w4.status = 'active';
      w4.task = { id: 'T-98', agent: 'verify-agent' };
      w4.lastActivity = at(141);
      w4.lastLine = '独立复验：加载 checkpoint、核对 loss、检查采样长度与 summary.json…';
      s.goal.status = 'verifying';
      s.goal.spent = 6.13;
      s.goal.lastActivity = at(141);
      log(s, {
        t: at(141),
        kind: 'start',
        who: '系统',
        text: '所有 Work 终态，生成整体验收并派给 verify-agent（T-98）',
        nodeId: 'W4',
      });
    },
  },
  {
    t: 150,
    label: '验收通过，等你确认',
    note: '3/3 项通过。按 D1 的建议，Goal 级验收由你关闭：确认完成，或带反馈再来一轮。这是整个流程里第三次、也是最后一次找你（前两次：预算、决策门）。',
    fresh: ['W4'],
    apply: (s) => {
      const w = N(s, 'W4');
      w.delivered = true;
      w.cost = 0.1;
      w.lastActivity = at(150);
      w.lastLine = undefined;
      w.attempts!.push({
        n: 1,
        started: at(141),
        ended: at(150),
        outcome: 'passed',
        cost: 0.1,
        reason: '独立 verifier 复验 checkpoint、loss、采样，3/3 通过',
        taskId: 'T-98',
      });
      s.goal.checks = s.goal.checks.map((c) => ({ ...c, state: 'passed' }));
      s.goal.status = 'review';
      s.goal.spent = 6.23;
      s.goal.lastActivity = at(150);
      log(s, {
        t: at(150),
        kind: 'pass',
        who: 'verifier',
        text: '整体验收 3/3 通过，等你确认',
        nodeId: 'W4',
      });
    },
  },
  {
    t: 151,
    label: '你确认完成',
    note: 'Goal 达成。"接下来"空了；图完整留存——决策门是橙色节点，有人参与过的 Work 带"你"角标（预算、决策、验收确认都记在 Work 上），随时可以回溯。',
    fresh: ['W4', 'G'],
    apply: (s) => {
      const w = N(s, 'W4');
      w.delivered = false;
      w.status = 'resolved';
      w.lastLine = undefined;
      w.humanTouches = [
        ...(w.humanTouches ?? []),
        { t: at(151), kind: 'accept', text: '确认验收：Goal 达成' },
      ];
      s.goal.status = 'achieved';
      s.goal.completedAt = at(151);
      s.goal.lastActivity = at(151);
      log(s, {
        t: at(151),
        kind: 'achieved',
        who: '你',
        text: '确认完成：Goal 达成',
        nodeId: 'W4',
      });
    },
  },
];

export const buildStep = (index: number): GoalState => {
  const s = INITIAL();
  for (let i = 0; i <= index; i++) STEPS[i].apply(s);
  clock.now = at(STEPS[index].t);
  return s;
};
