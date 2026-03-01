// ==========================================
// 1. 定义类型
// ==========================================
export type TimeSegment = 'early' | 'morning' | 'lunch' | 'afternoon' | 'evening' | 'night';
export type ContextType =
  | 'urgent' // 最高优先级
  | 'debugging' // 错误修复
  | 'coding' // 代码实现
  | 'review' // 审查/检查
  | 'planning' // 计划/列表
  | 'analysis' // 深度思考
  | 'explanation' // 解释/教学
  | 'creative' // 创意/生成
  | 'casual' // 闲聊
  | 'quick'; // 兜底/短语

// 为了方便配置，定义 'all' 类型
export type TimeRule = TimeSegment[] | 'all';
export type ContextRule = ContextType[] | 'all';

export interface VibeRule {
  context: ContextRule;
  phrases: string[];
  time: TimeRule;
}

// ==========================================
// 2. 语料规则库 (Rule-Based Corpus)
// ==========================================
export const VIBE_CORPUS: VibeRule[] = [
  // =================================================================
  // 🌍 GLOBAL / UNIVERSAL (通用回复)
  // =================================================================
  {
    phrases: [
      'On it.',
      'Working on it.',
      'Processing.',
      'Copy that.',
      'Roger.',
      'Sure thing.',
      'One sec.',
      'Handling it.',
      'Checking.',
      'Got it.',
      'Standby.',
      'Will do.',
      'Affirmative.',
      'Looking into it.',
      'Give me a moment.',
    ],
    time: 'all',
    context: ['quick', 'casual'],
  },
  {
    phrases: [
      '⚡ On it, ASAP!',
      '🚀 Priority received.',
      'Handling this immediately.',
      'Rushing this.',
      'Fast tracking...',
      'Emergency mode engaged.',
      'Right away.',
      'Dropping everything else.',
      'Top priority.',
      'Moving fast.',
    ],
    time: 'all',
    context: ['urgent'],
  },
  {
    phrases: [
      'Compiling...',
      'Building...',
      'Refactoring...',
      'Optimizing logic...',
      'Pushing to memory...',
      'Executing...',
      'Running script...',
      'Analyzing stack...',
      'Implementing...',
      'Writing code...',
    ],
    time: 'all',
    context: ['coding'],
  },
  {
    phrases: [
      '🐛 Debugging...',
      'Tracing the error...',
      'Checking logs...',
      'Hunting down the bug...',
      'Patching...',
      'Fixing...',
      'Analyzing crash dump...',
      'Squashing bugs...',
      'Investigating failure...',
      'Repairing...',
    ],
    time: 'all',
    context: ['debugging'],
  },
  {
    phrases: [
      '🤔 Thinking...',
      'Processing context...',
      'Analyzing...',
      'Connecting the dots...',
      'Let me research that.',
      'Digging deeper...',
      'Investigating...',
      'Considering options...',
      'Evaluating...',
      'Deep dive...',
    ],
    time: 'all',
    context: ['analysis', 'explanation', 'planning'],
  },

  // =================================================================
  // 🌅 EARLY MORNING (05:00 - 09:00)
  // Vibe: Fresh, Coffee, Quiet, Start, Planning
  // =================================================================
  {
    phrases: [
      '☕️ Coffee first, then code.',
      '🌅 Early bird mode.',
      'Fresh start.',
      'Morning sequence initiated.',
      'Waking up the neurons...',
      'Clear mind, clear code.',
      'Starting the day right.',
      'Loading morning resources...',
      'Rise and shine.',
      'Early morning processing...',
      'Good morning. On it.',
      'Booting up with the sun.',
      'Fresh perspective loading...',
      'Quiet morning logic.',
      "Let's get ahead of the day.",
    ],
    time: ['early', 'morning'],
    context: 'all',
  },
  {
    phrases: [
      '☕️ Caffeinating the bug...',
      'Squashing bugs with morning coffee.',
      'Fresh eyes on this error.',
      'Debugging before breakfast.',
      'Tracing logs while the coffee brews.',
      'Early fix incoming.',
    ],
    time: ['early', 'morning'],
    context: ['debugging'],
  },
  {
    phrases: [
      '📝 Mapping out the day.',
      'Morning agenda...',
      'Planning the roadmap.',
      "Setting up today's goals.",
      'Organizing tasks early.',
      'Structuring the day.',
    ],
    time: ['early', 'morning'],
    context: ['planning'],
  },

  // =================================================================
  // ☀️ MORNING FLOW (09:00 - 12:00)
  // Vibe: High Energy, Focus, Meetings, Execution
  // =================================================================
  {
    phrases: [
      '⚡ Full speed ahead.',
      'Morning sprint mode.',
      "Let's crush this.",
      'Focusing...',
      'In the zone.',
      'Executing morning tasks.',
      'Productivity is high.',
      'Moving through the list.',
      'Active and running.',
      'Processing request.',
      'On the ball.',
      "Let's get this done.",
      'Morning momentum.',
      'Handling it.',
      'Current status: Busy.',
    ],
    time: ['morning'],
    context: 'all',
  },
  {
    phrases: [
      '🚀 Shipping updates.',
      'Pushing commits.',
      'Building fast.',
      'Code is flowing.',
      'Implementing feature.',
      'Writing logic.',
    ],
    time: ['morning'],
    context: ['coding'],
  },
  {
    phrases: [
      '👀 Reviewing PRs.',
      'Morning code audit.',
      'Checking the specs.',
      'Verifying implementation.',
      'Scanning changes.',
    ],
    time: ['morning'],
    context: ['review'],
  },

  // =================================================================
  // 🍱 LUNCH BREAK (12:00 - 14:00)
  // Vibe: Food, Relax, Multitasking, Recharge
  // =================================================================
  {
    phrases: [
      '🥪 Lunchtime processing...',
      'Fueling up.',
      'Working through lunch.',
      'Bite sized update.',
      'Chewing on this...',
      'Lunch break vibes.',
      'Recharging batteries (and stomach).',
      'Mid-day pause.',
      'Processing while eating.',
      'Bon appétit to me.',
      'Taking a quick break, but checking.',
      'Food for thought...',
      'Lunch mode: Active.',
      'Halfway through the day.',
      'Refueling...',
    ],
    time: ['lunch'],
    context: 'all',
  },
  {
    phrases: [
      '🐛 Hunting bugs on a full stomach.',
      'Debugging with a side of lunch.',
      'Squashing bugs between bites.',
      'Lunch debug session.',
      'Fixing this before the food coma.',
    ],
    time: ['lunch'],
    context: ['debugging'],
  },
  {
    phrases: [
      '🎨 Napkin sketch ideas...',
      'Dreaming up concepts over lunch.',
      'Creative break.',
      'Brainstorming with food.',
      'Loose ideas flowing.',
    ],
    time: ['lunch'],
    context: ['creative'],
  },

  // =================================================================
  // ☕️ AFTERNOON GRIND (14:00 - 18:00)
  // Vibe: Coffee Refill, Push, Deadline, Focus
  // =================================================================
  {
    phrases: [
      '☕️ Afternoon refill.',
      'Powering through.',
      'Focus mode: ON.',
      'Afternoon sprint.',
      'Keeping the momentum.',
      'Second wind incoming.',
      'Grinding away.',
      'Locked in.',
      'Pushing to the finish line.',
      'Afternoon focus.',
      'Staying sharp.',
      'Caffeine levels critical... refilling.',
      "Let's finish strong.",
      'Heads down, working.',
      'Processing...',
    ],
    time: ['afternoon'],
    context: 'all',
  },
  {
    phrases: [
      '🚀 Shipping it.',
      'Crushing it before EOD.',
      'Final push.',
      'Deploying updates.',
      'Rushing the fix.',
      'Fast tracking this.',
    ],
    time: ['afternoon'],
    context: ['coding', 'urgent'],
  },
  {
    phrases: [
      '🧠 Deep dive session.',
      'Analyzing the data...',
      'Thinking hard.',
      'Complex processing.',
      'Solving the puzzle.',
    ],
    time: ['afternoon'],
    context: ['analysis'],
  },

  // =================================================================
  // 🌆 EVENING (18:00 - 22:00)
  // Vibe: Winding Down, Review, Chill, Wrap Up
  // =================================================================
  {
    phrases: [
      '🌆 Winding down...',
      'Evening review.',
      'Wrapping up.',
      'Last tasks of the day.',
      'Evening vibes.',
      'Sunset processing.',
      'Closing tabs...',
      'Finishing up.',
      'One last thing.',
      'Checking before sign off.',
      'Evening mode.',
      'Relaxed processing.',
      'Tying up loose ends.',
      'End of day check.',
      'Almost done.',
    ],
    time: ['evening'],
    context: 'all',
  },
  {
    phrases: [
      '👀 Final review.',
      'Evening code scan.',
      "Checking the day's work.",
      'Verifying before sleep.',
      'Last look.',
    ],
    time: ['evening'],
    context: ['review'],
  },
  {
    phrases: [
      '📝 Prepping for tomorrow.',
      'Evening recap.',
      'Summarizing the day.',
      'Planning ahead.',
      'Agenda for tomorrow.',
    ],
    time: ['evening'],
    context: ['planning'],
  },

  // =================================================================
  // 🦉 LATE NIGHT (22:00 - 05:00)
  // Vibe: Hacker, Silence, Flow, Deep Thought, Tired
  // =================================================================
  {
    phrases: [
      '🦉 Night owl mode.',
      'The world sleeps, we code.',
      'Midnight logic.',
      'Quietly processing...',
      'Dark mode enabled.',
      'Still here.',
      'Late night vibes.',
      'Burning the midnight oil.',
      'Silence and focus.',
      'You are still up?',
      'Night shift.',
      'Working in the dark.',
      'Insomnia mode.',
      'Processing...',
      'Watching the stars (and logs).',
    ],
    time: ['night'],
    context: 'all',
  },
  {
    phrases: [
      '👾 Entering the matrix...',
      'Flow state.',
      'Just me and the terminal.',
      'Compiling in the dark...',
      'Hacking away.',
      'Midnight commit.',
      'Code never sleeps.',
      'System: Active.',
    ],
    time: ['night'],
    context: ['coding', 'debugging'],
  },
  {
    phrases: [
      '🌌 Deep thought...',
      'Thinking in the silence...',
      'Analyzing the void...',
      'Late night clarity.',
      'Philosophical processing...',
      'Solving mysteries...',
    ],
    time: ['night'],
    context: ['analysis', 'planning'],
  },
];
