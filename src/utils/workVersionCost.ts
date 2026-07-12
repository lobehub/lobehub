export const formatWorkVersionCost = (cost?: number | null): string | null => {
  if (!cost || cost <= 0) return null;

  if (cost < 0.01) return `$${cost.toFixed(4)}`;

  return `$${cost.toFixed(2)}`;
};
