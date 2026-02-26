const ACK_EMOJIS = [
  '🫡',
  '🤙',
  '👌',
  '🚀',
  '⚡',
  '🔥',
  '💪',
  '🧠',
  '🎯',
  '🛠️',
  '✨',
  '👀',
  '🤓',
  '🏃',
  '⏳',
  '🧐',
  '📡',
  '🔍',
  '💡',
  '🤖',
];

const ACK_PHRASES = [
  'On it, give me a sec...',
  'Got it, working on this now...',
  'Roger that, let me look into it...',
  'Sure thing, one moment...',
  'Alright, let me figure this out...',
  'Copy that, digging in...',
  'Understood, working on it...',
  'Leave it to me...',
  'Got it, let me think about this...',
  'On the case, hang tight...',
  'Noted, let me check...',
  'Right away, one sec...',
  'Yep, looking into this now...',
  "I'm on it, just a moment...",
  'Let me handle this for you...',
  'Give me a moment to work this out...',
  'Sure, let me take a look...',
  'Working on it, bear with me...',
  'Gotcha, processing now...',
  'OK, let me get back to you on this...',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomAck(): string {
  return `${pick(ACK_EMOJIS)} ${pick(ACK_PHRASES)}`;
}
