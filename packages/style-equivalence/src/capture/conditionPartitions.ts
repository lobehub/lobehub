import valueParser from 'postcss-value-parser';

export interface WidthCondition {
  bounds: Array<{ operator: '<' | '<=' | '=' | '>' | '>='; value: number }>;
  name?: string;
}

/** Conservative token AST grammar. Unsupported logic is not approximated. */
export const parseWidthCondition = (text: string): WidthCondition | undefined => {
  const nodes = valueParser(text).nodes.filter((node) => !['space', 'comment'].includes(node.type));
  let name: string | undefined;
  if (
    nodes[0]?.type === 'word' &&
    /^[a-z_][\w-]*$/i.test(nodes[0].value) &&
    !['not', 'only', 'all', 'screen', 'print'].includes(nodes[0].value)
  )
    name = nodes.shift()!.value;
  const bounds: WidthCondition['bounds'] = [];
  const number = (value: string) => {
    const match = value.match(/^(\d+(?:\.\d+)?|\.\d+)px$/i);
    return match && Number.isFinite(Number(match[1])) ? Number(match[1]) : undefined;
  };
  const inverse = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '=': '=' } as const;
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (index % 2) {
      if (node.type !== 'word' || node.value !== 'and') return;
      continue;
    }
    if (node.type !== 'function' || node.value || node.unclosed) return;
    const parts = node.nodes
      .filter((part) => !['space', 'comment'].includes(part.type))
      .map((part) => (part.type === 'word' || part.type === 'div' ? part.value : '?'));
    if (
      parts.length === 3 &&
      parts[1] === ':' &&
      ['min-width', 'max-width', 'width'].includes(parts[0])
    ) {
      const value = number(parts[2]);
      if (value === undefined) return;
      bounds.push({
        operator: parts[0] === 'min-width' ? '>=' : parts[0] === 'max-width' ? '<=' : '=',
        value,
      });
    } else if ([3, 5].includes(parts.length)) {
      for (let cursor = 0; cursor < parts.length - 2; cursor += 2) {
        const [left, operator, right] = parts.slice(cursor, cursor + 3);
        if (!Object.hasOwn(inverse, operator)) return;
        const typed = operator as keyof typeof inverse;
        const value = number(left === 'width' ? right : left);
        if (value === undefined || (left !== 'width' && right !== 'width')) return;
        bounds.push({ operator: left === 'width' ? typed : inverse[typed], value });
      }
    } else return;
  }
  return bounds.length && nodes.length % 2 ? { bounds, name } : undefined;
};

export const matchesWidth = (condition: WidthCondition, width: number) =>
  condition.bounds.every(({ operator, value }) => {
    switch (operator) {
      case '<': {
        return width < value;
      }
      case '<=': {
        return width <= value;
      }
      case '>': {
        return width > value;
      }
      case '>=': {
        return width >= value;
      }
      case '=': {
        return width === value;
      }
    }
  });

/** Explicit finite host contract; interiors never jump across close boundaries. */
export const partitionWidths = (conditions: WidthCondition[], minimum: number, maximum: number) => {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0 || minimum >= maximum)
    throw new Error('INVALID_WIDTH_DOMAIN');
  const boundaries = [
    ...new Set([
      minimum,
      maximum,
      ...conditions
        .flatMap((condition) => condition.bounds.map((bound) => bound.value))
        .filter((value) => value > minimum && value < maximum),
    ]),
  ].sort((a, b) => a - b);
  const widths = [...boundaries];
  for (let index = 1; index < boundaries.length; index++)
    widths.push((boundaries[index - 1] + boundaries[index]) / 2);
  return widths.sort((a, b) => a - b);
};

/** Keep every boundary and open interval. Existing probes may represent an
 * interval, but are never treated as proof of fluid-layout equivalence. */
export const partitionWidthCells = (
  conditions: WidthCondition[],
  minimum: number,
  maximum: number,
  preferred: number[] = [],
) => {
  partitionWidths(conditions, minimum, maximum); // validates the declared domain
  const boundaries = [
    ...new Set([
      minimum,
      maximum,
      ...conditions.flatMap((condition) =>
        condition.bounds
          .map((bound) => bound.value)
          .filter((value) => value > minimum && value < maximum),
      ),
    ]),
  ].sort((a, b) => a - b);
  return boundaries.flatMap((width, index) => {
    const result = [{ id: `[${width}]`, width }];
    const next = boundaries[index + 1];
    if (next !== undefined) {
      const midpoint = (width + next) / 2;
      const available = preferred
        .filter((value) => value > width && value < next)
        .sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint) || a - b);
      result.push({ id: `(${width},${next})`, width: available[0] ?? midpoint });
    }
    return result;
  });
};
