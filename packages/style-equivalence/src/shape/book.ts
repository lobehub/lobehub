import type { ComponentShape, ShapeBook } from '../plan/shapes';

export type ShapeReading = Record<string, ComponentShape>;

export const mergeWidths = (readings: ShapeReading[]): ShapeReading => {
  const [first, ...rest] = readings;
  if (!first) return {};
  return Object.fromEntries(
    Object.entries(first).filter(([key, shape]) =>
      rest.every((reading) => JSON.stringify(reading[key]) === JSON.stringify(shape)),
    ),
  );
};

export const bookOf = (sides: Partial<Record<'base' | 'head', ShapeReading>>): ShapeBook => {
  const book: ShapeBook = {};
  for (const side of ['base', 'head'] as const)
    for (const [key, shape] of Object.entries(sides[side] ?? {})) (book[key] ??= {})[side] = shape;
  return book;
};
