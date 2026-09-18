export const formatCost = (value?: number): string =>
  typeof value === 'number' ? `$${value.toLocaleString('en-US')}` : 'n/a';
