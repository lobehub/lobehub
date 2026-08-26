// Time and money formatting. `clock.now` is the "current time" of the rendered step so relative
// ages stay truthful while replaying; production reads Date.now().

export const min = (n: number) => n * 60_000;

export const clock = { now: 0 };

export const ago = (ms: number) => {
  if (ms < min(1)) return '刚刚';
  if (ms < min(60)) return `${Math.round(ms / min(1))} 分钟前`;
  const h = Math.floor(ms / min(60));
  if (h < 24)
    return `${h} 小时${h < 3 ? ` ${Math.round((ms - h * min(60)) / min(1))} 分钟` : ''}前`;
  return `${Math.floor(h / 24)} 天前`;
};

export const duration = (ms: number) => ago(ms).replace('前', '');

export const short = (ms: number) =>
  ms < min(1)
    ? '刚刚'
    : ms < min(60)
      ? `${Math.round(ms / min(1))}m`
      : ms < min(60 * 24)
        ? `${Math.floor(ms / min(60))}h`
        : `${Math.floor(ms / min(60 * 24))}d`;

export const usd = (n: number) => `$${n.toFixed(2)}`;

export const hhmm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
