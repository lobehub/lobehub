/** A slot with no samples charts as a gap; formatters must accept it. */
type ChartValue = number | null | undefined;

export const formatPercent = (value: ChartValue) =>
  value === null || value === undefined ? '—' : `${Math.round(value)}%`;

export const formatLoad = (value: ChartValue) =>
  value === null || value === undefined ? '—' : value.toFixed(2);
