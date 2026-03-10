import type { ContextType, TimeSegment } from './vibeMatrix';
import { VIBE_CORPUS } from './vibeMatrix';

// Simple sample implementation to avoid dependency issues
function sample<T>(arr: T[]): T | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ==========================================
// 3. Smart Detector (The Brain)
// ==========================================

/**
 * Get the current hour (0-23) in the specified timezone
 */
function getLocalHour(date: Date, timeZone?: string): number {
  if (!timeZone) return date.getHours();

  try {
    // Use the Intl API to format the time as the hour number in the specified timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone,
    });
    const hourStr = formatter.format(date);

    // Handle the possible edge case of '24' (extremely rare, but for robustness)
    const hour = parseInt(hourStr, 10);
    return hour === 24 ? 0 : hour;
  } catch (e) {
    // If the timezone is invalid, fall back to server time
    console.warn(`[getExtremeAck] Invalid timezone: ${timeZone}, falling back to server time.`);
    return date.getHours();
  }
}

function getTimeSegment(hour: number): TimeSegment {
  if (hour >= 5 && hour < 9) return 'early';
  if (hour >= 9 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 14) return 'lunch';
  if (hour >= 14 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
}

function getContextType(content: string): ContextType {
  const lower = content.toLowerCase();

  // 1. 🚨 Urgent (highest priority)
  if (/asap|urgent|emergency|!!!|quick|fast|hurry|立刻|马上|紧急/.test(lower)) {
    return 'urgent';
  }

  // 2. 🐛 Debugging (clear characteristics)
  if (/error|bug|fix|crash|fail|exception|undefined|null|报错|挂了|修复/.test(lower)) {
    return 'debugging';
  }

  // 3. 💻 Coding (code characteristics)
  if (
    /const |import |function |=> |class |return |<\/|npm |git |docker|sudo|pip|api|json/.test(lower)
  ) {
    return 'coding';
  }

  // 4. 👀 Review (request to look at)
  if (/review|check|look at|opinion|verify|audit|审查|看看|检查/.test(lower)) {
    return 'review';
  }

  // 5. 📝 Planning (lists/plans)
  if (/plan|todo|list|roadmap|schedule|summary|agenda|计划|安排|总结/.test(lower)) {
    return 'planning';
  }

  // 6. 📚 Explanation (questions/teaching)
  if (/what is|how to|explain|guide|tutorial|teach|meaning|什么是|怎么做|解释/.test(lower)) {
    return 'explanation';
  }

  // 7. 🎨 Creative (creation/design)
  if (/design|draft|write|idea|brainstorm|generate|create|image|logo|设计|文案|生成/.test(lower)) {
    return 'creative';
  }

  // 8. 🧠 Analysis (fallback for long thinking)
  if (
    content.includes('?') ||
    content.length > 60 ||
    /analyze|compare|research|think|why|分析|研究/.test(lower)
  ) {
    return 'analysis';
  }

  // 9. 💬 Casual (short and non-instructive)
  if (/hello|hi|hey|thanks|cool|wow|lol|哈哈|你好|谢谢/.test(lower)) {
    return 'casual';
  }

  // 10. 👌 Quick (fallback)
  return 'quick';
}

function humanizeText(text: string): string {
  // 10% chance to lowercase the first letter (looks casual)
  if (Math.random() < 0.1) {
    text = text.charAt(0).toLowerCase() + text.slice(1);
  }

  // 10% chance to remove trailing punctuation
  if (Math.random() < 0.1 && text.endsWith('.')) {
    text = text.slice(0, -1);
  }

  return text;
}

// ==========================================
// 4. Main Entry
// ==========================================

export interface AckOptions {
  /**
   * Force a specific time (for testing)
   */
  date?: Date;
  /**
   * The user's timezone (e.g. 'Asia/Shanghai', 'America/New_York')
   * If not provided, defaults to server time
   */
  timezone?: string;
}

export function getExtremeAck(content: string = '', options: AckOptions = {}): string {
  const now = options.date || new Date();

  // Calculate the hour in the user's local time
  const localHour = getLocalHour(now, options.timezone);
  const timeSeg = getTimeSegment(localHour);

  const contextType = getContextType(content);

  // Filter all rules that match the current time segment and context
  const candidates = VIBE_CORPUS.filter((rule) => {
    // Check time match
    const timeMatch = rule.time === 'all' || rule.time.includes(timeSeg);
    // Check context match
    const contextMatch = rule.context === 'all' || rule.context.includes(contextType);

    return timeMatch && contextMatch;
  }).flatMap((rule) => rule.phrases);

  // If no rules matched, use the universal fallback
  if (candidates.length === 0) {
    return 'Processing...';
  }

  const selected = sample(candidates) || 'Processing...';
  return humanizeText(selected);
}
