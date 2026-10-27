const compact = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, notation: 'compact' });
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, style: 'percent' });
const TIGHT_UNIT = /^[%‰°′″]/;

export const formatValue = (value: unknown, format?: unknown, unit?: unknown): string => {
  if (typeof value !== 'number') return value === undefined || value === null ? '' : String(value);

  let text: string;
  switch (format) {
    case 'compact': {
      text = compact.format(value);
      break;
    }
    case 'percent': {
      text = percent.format(Math.abs(value) > 1 ? value / 100 : value);
      break;
    }
    case 'currency': {
      text = `$${number.format(value)}`;
      break;
    }
    default: {
      text = number.format(value);
    }
  }

  if (typeof unit !== 'string' || !unit) return text;
  return TIGHT_UNIT.test(unit) ? `${text}${unit}` : `${text} ${unit}`;
};

export const heatmapLevel = (count: number, max: number) =>
  count <= 0 || max <= 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4));
