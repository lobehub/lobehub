import type { ContextType, TimeSegment } from './vibeMatrix';
import { VIBE_CORPUS } from './vibeMatrix';

// Simple sample implementation to avoid dependency issues
function sample<T>(arr: T[]): T | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ==========================================
// 3. 智能检测器 (The Brain)
// ==========================================

/**
 * 获取指定时区下的当前小时数 (0-23)
 */
function getLocalHour(date: Date, timeZone?: string): number {
  if (!timeZone) return date.getHours();

  try {
    // 使用 Intl API 将时间格式化为指定时区的小时数
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone,
    });
    const hourStr = formatter.format(date);

    // 处理可能的 '24' 这种边缘情况（极少见，但为了稳健）
    const hour = parseInt(hourStr, 10);
    return hour === 24 ? 0 : hour;
  } catch (e) {
    // 如果时区无效，回退到服务器时间
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

  // 1. 🚨 Urgent (最高优先级)
  if (/asap|urgent|emergency|!!!|quick|fast|hurry|立刻|马上|紧急/.test(lower)) {
    return 'urgent';
  }

  // 2. 🐛 Debugging (特征明显)
  if (/error|bug|fix|crash|fail|exception|undefined|null|报错|挂了|修复/.test(lower)) {
    return 'debugging';
  }

  // 3. 💻 Coding (代码特征)
  if (
    /const |import |function |=> |class |return |<\/|npm |git |docker|sudo|pip|api|json/.test(lower)
  ) {
    return 'coding';
  }

  // 4. 👀 Review (请求查看)
  if (/review|check|look at|opinion|verify|audit|审查|看看|检查/.test(lower)) {
    return 'review';
  }

  // 5. 📝 Planning (列表/计划)
  if (/plan|todo|list|roadmap|schedule|summary|agenda|计划|安排|总结/.test(lower)) {
    return 'planning';
  }

  // 6. 📚 Explanation (提问/教学)
  if (/what is|how to|explain|guide|tutorial|teach|meaning|什么是|怎么做|解释/.test(lower)) {
    return 'explanation';
  }

  // 7. 🎨 Creative (创作/设计)
  if (/design|draft|write|idea|brainstorm|generate|create|image|logo|设计|文案|生成/.test(lower)) {
    return 'creative';
  }

  // 8. 🧠 Analysis (兜底的长思考)
  if (
    content.includes('?') ||
    content.length > 60 ||
    /analyze|compare|research|think|why|分析|研究/.test(lower)
  ) {
    return 'analysis';
  }

  // 9. 💬 Casual (短且非指令)
  if (/hello|hi|hey|thanks|cool|wow|lol|哈哈|你好|谢谢/.test(lower)) {
    return 'casual';
  }

  // 10. 👌 Quick (兜底)
  return 'quick';
}

function humanizeText(text: string): string {
  // 10% 的概率把首字母变成小写（显得随意）
  if (Math.random() < 0.1) {
    text = text.charAt(0).toLowerCase() + text.slice(1);
  }

  // 10% 的概率去掉末尾标点
  if (Math.random() < 0.1 && text.endsWith('.')) {
    text = text.slice(0, -1);
  }

  return text;
}

// ==========================================
// 4. 主入口
// ==========================================

export interface AckOptions {
  /**
   * 强制指定时间 (用于测试)
   */
  date?: Date;
  /**
   * 用户所在的时区 (e.g. 'Asia/Shanghai', 'America/New_York')
   * 如果不传，默认使用服务器时间
   */
  timezone?: string;
}

export function getExtremeAck(content: string = '', options: AckOptions = {}): string {
  const now = options.date || new Date();

  // 计算用户当地时间的小时数
  const localHour = getLocalHour(now, options.timezone);
  const timeSeg = getTimeSegment(localHour);

  const contextType = getContextType(content);

  // 筛选符合当前时间段和上下文的所有规则
  const candidates = VIBE_CORPUS.filter((rule) => {
    // 检查时间匹配
    const timeMatch = rule.time === 'all' || rule.time.includes(timeSeg);
    // 检查上下文匹配
    const contextMatch = rule.context === 'all' || rule.context.includes(contextType);

    return timeMatch && contextMatch;
  }).flatMap((rule) => rule.phrases);

  // 如果没有匹配到任何规则，使用通用兜底
  if (candidates.length === 0) {
    return 'Processing...';
  }

  const selected = sample(candidates) || 'Processing...';
  return humanizeText(selected);
}
