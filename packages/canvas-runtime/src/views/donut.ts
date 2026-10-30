type Props = Record<string, any>;

// The center label is the sum of the slices, which is always "100%" for shares
export const showsDonutTotal = (props: Props) =>
  props.unit !== '%' && props['value-format'] !== 'percent';

export const donutLegendCategories = (rows: Props[], index: unknown) =>
  typeof index === 'string' ? rows.map((row) => String(row[index] ?? '')) : [];
