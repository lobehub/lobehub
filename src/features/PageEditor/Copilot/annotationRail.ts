import type { AnnotationAnchorMeasurement, AnnotationRecord } from '@lobehub/editor';

export const DEFAULT_ANNOTATION_GROUP_EPSILON = 16;
export const DEFAULT_ANNOTATION_CARD_HEIGHT = 104;
export const DEFAULT_COMPOSER_HEIGHT = 300;
export const DEFAULT_ANNOTATION_GAP = 12;

export type AnnotationRailItemKind = 'annotation' | 'composer';

export interface AnnotationRailMeasurement {
  /** Stable semantic block identity returned by the editor's DOM measurement API. */
  anchorGroupKey?: string;
  anchorY: number;
  createdAt: string;
  height?: number;
  id: string;
  kind?: AnnotationRailItemKind;
  record?: AnnotationRecord;
}

export interface CollectAnnotationMeasurementsOptions {
  /** Offset from the editor-root coordinate space into the rail canvas. */
  anchorOffset?: number;
  /** Conservative card height used by the first layout pass. */
  height?: number;
}

/**
 * Converts DOM anchor measurements into rail measurements.
 *
 * A missing DOM anchor is not a document position. In particular, it must not
 * be replaced by the current viewport (or zero), otherwise a deleted range
 * briefly appears at the top of the rail before reconciliation marks it
 * orphaned. Keeping this gate in the pure rail layer also makes every caller
 * obey the same rule.
 */
export const collectAnchoredAnnotationMeasurements = (
  records: ReadonlyArray<AnnotationRecord>,
  measure: (record: AnnotationRecord) => AnnotationAnchorMeasurement | null,
  options: CollectAnnotationMeasurementsOptions = {},
): AnnotationRailMeasurement[] => {
  const anchorOffset = Number.isFinite(options.anchorOffset) ? (options.anchorOffset ?? 0) : 0;
  const height = Number.isFinite(options.height) ? options.height : undefined;

  return records.flatMap((record) => {
    if (record.status === 'orphaned') return [];

    const measurement = measure(record);
    if (!measurement || !Number.isFinite(measurement.anchorY)) return [];

    return [
      {
        anchorGroupKey: measurement.anchorGroupKey,
        anchorY: anchorOffset + measurement.anchorY,
        createdAt: record.createdAt,
        height,
        id: record.id,
        record,
      },
    ];
  });
};

export interface AnnotationRailGroup {
  /** Present when the group is anchored to a semantic editor block. */
  anchorGroupKey?: string;
  anchorY: number;
  createdAt: string;
  id: string;
  items: AnnotationRailMeasurement[];
}

interface WorkingAnnotationRailGroup extends AnnotationRailGroup {
  lastAnchorY: number;
}

const normalizeAnchorGroupKey = (value: string | undefined): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const getStableAnchorGroupId = (
  measurement: Pick<AnnotationRailMeasurement, 'anchorGroupKey' | 'anchorY'>,
  epsilon: number,
): string => {
  const anchorGroupKey = normalizeAnchorGroupKey(measurement.anchorGroupKey);
  if (anchorGroupKey) {
    return `annotation-group:key:${encodeURIComponent(anchorGroupKey)}`;
  }

  // Coordinate-only groups are inherently less durable than semantic block
  // groups. Quantizing by epsilon keeps a newly inserted annotation from
  // replacing a group's id merely because it sorts before the old first item.
  const bucketSize = Number.isFinite(epsilon) && epsilon > 0 ? epsilon : 1;
  const anchorY = Number.isFinite(measurement.anchorY) ? measurement.anchorY : 0;
  return `annotation-group:anchor:${Math.floor(anchorY / bucketSize)}`;
};

export interface AnnotationRailLayoutItem {
  anchorY: number;
  createdAt: string;
  expanded?: boolean;
  group?: AnnotationRailGroup;
  height: number;
  id: string;
  kind: AnnotationRailItemKind;
  y: number;
}

export interface AnnotationRailLayoutOptions {
  documentHeight: number;
  gap?: number;
}

export interface AnnotationAutoExpandOptions {
  /** Bottom boundary of the rail document. */
  documentHeight: number;
  /** Actual or conservative estimated height when the group is expanded. */
  expandedHeight: number;
  gap?: number;
  /** Top of the group in the rail's document coordinate space. */
  groupY: number;
  /** Top of the next layout item, including a composer, when one exists. */
  nextY?: number | null;
}

export interface ComposerAnchorYOptions {
  /** Composer rect converted to editor-root document coordinates. */
  nativeRectY?: number | null;
  /** Saved selection/node DOM anchor converted to editor-root coordinates. */
  nodeAnchorY?: number | null;
  /** Current editor scroll viewport converted to editor-root coordinates. */
  viewportY: number;
}

/**
 * Resolves a composer anchor without ever treating the rail/canvas origin as a
 * document position. Native range geometry is the most precise signal; saved
 * Lexical node geometry survives toolbar/sidebar focus changes; the visible
 * editor viewport is the final safe fallback.
 */
export const resolveComposerAnchorY = ({
  nativeRectY,
  nodeAnchorY,
  viewportY,
}: ComposerAnchorYOptions): number => {
  if (Number.isFinite(nativeRectY)) return nativeRectY as number;
  if (Number.isFinite(nodeAnchorY)) return nodeAnchorY as number;
  return Number.isFinite(viewportY) ? viewportY : 0;
};

export interface AnnotationRailLayoutResult {
  height: number;
  items: AnnotationRailLayoutItem[];
}

/** Locate the layout item that owns a clicked annotation id. */
export const findAnnotationGroupItem = (
  items: ReadonlyArray<AnnotationRailLayoutItem>,
  annotationId: string,
): AnnotationRailLayoutItem | null =>
  items.find(
    (item) =>
      item.kind === 'annotation' &&
      item.group?.items.some(
        (measurement) =>
          measurement.id === annotationId && measurement.record?.status !== 'orphaned',
      ),
  ) ?? null;

export interface AnnotationRailNavigationRequest {
  annotationId: string;
  token: number;
}

export interface AnnotationRailNavigationPending {
  annotationId: string;
  groupId: string | null;
  token: number;
}

export interface AnnotationRailNavigationState {
  consumedToken: number | null;
  pending: AnnotationRailNavigationPending | null;
}

export const initialAnnotationRailNavigationState: AnnotationRailNavigationState = {
  consumedToken: null,
  pending: null,
};

export interface AnnotationRailNavigationPreparation {
  expandGroupId?: string;
  selectedGroupId?: string;
  state: AnnotationRailNavigationState;
}

/**
 * Keep a navigation request pending until its annotation is present in the
 * current layout. A request whose target is not measured remains unresolved
 * so a later snapshot can resolve it; a consumed token is never re-armed by
 * ordinary measurement updates.
 */
export const prepareAnnotationRailNavigation = (
  state: AnnotationRailNavigationState,
  request: AnnotationRailNavigationRequest | null | undefined,
  target: Pick<AnnotationRailLayoutItem, 'id'> | null,
): AnnotationRailNavigationPreparation => {
  if (!request || request.token === state.consumedToken) return { state };

  const pending = state.pending;
  if (pending?.token === request.token && pending.annotationId === request.annotationId) {
    if (!target || pending.groupId === target.id) return { state };

    return {
      expandGroupId: target.id,
      selectedGroupId: target.id,
      state: {
        ...state,
        pending: { ...pending, groupId: target.id },
      },
    };
  }

  if (!target) {
    return {
      state: {
        ...state,
        pending: {
          annotationId: request.annotationId,
          groupId: null,
          token: request.token,
        },
      },
    };
  }

  return {
    expandGroupId: target.id,
    selectedGroupId: target.id,
    state: {
      ...state,
      pending: {
        annotationId: request.annotationId,
        groupId: target.id,
        token: request.token,
      },
    },
  };
};

export interface AnnotationRailNavigationConsumption {
  shouldScroll: boolean;
  state: AnnotationRailNavigationState;
}

/**
 * Consume a pending request only once the expanded group has rendered and is
 * mounted. The caller performs the actual scroll immediately after this
 * returns `shouldScroll: true`.
 */
export const consumeAnnotationRailNavigation = (
  state: AnnotationRailNavigationState,
  request: AnnotationRailNavigationRequest | null | undefined,
  target: Pick<AnnotationRailLayoutItem, 'id' | 'kind' | 'expanded'> | null,
  isMounted: boolean,
): AnnotationRailNavigationConsumption => {
  const pending = state.pending;
  if (
    !request ||
    !pending ||
    pending.token !== request.token ||
    pending.annotationId !== request.annotationId ||
    !target ||
    target.kind !== 'annotation' ||
    target.id !== pending.groupId ||
    target.expanded !== true ||
    !isMounted
  ) {
    return { shouldScroll: false, state };
  }

  return {
    shouldScroll: true,
    state: {
      consumedToken: pending.token,
      pending: null,
    },
  };
};

export interface AnnotationRailScrollTargetOptions {
  groupHeight?: number;
  groupY: number;
  maxScrollTop: number;
  viewportHeight: number;
}

/** Center a group in the rail viewport while respecting both scroll bounds. */
export const getAnnotationRailScrollTarget = ({
  groupHeight = 0,
  groupY,
  maxScrollTop,
  viewportHeight,
}: AnnotationRailScrollTargetOptions): number => {
  const safeGroupY = Number.isFinite(groupY) ? groupY : 0;
  const safeGroupHeight = Math.max(0, Number.isFinite(groupHeight) ? groupHeight : 0);
  const safeViewportHeight = Math.max(0, Number.isFinite(viewportHeight) ? viewportHeight : 0);
  const safeMaxScrollTop = Math.max(0, Number.isFinite(maxScrollTop) ? maxScrollTop : 0);
  const centeredTop = safeGroupY - Math.max(0, (safeViewportHeight - safeGroupHeight) / 2);
  return Math.min(Math.max(0, centeredTop), safeMaxScrollTop);
};

/**
 * Decide whether a comment group can be expanded without consuming the next
 * layout slot or extending past the rail document. This deliberately only
 * depends on geometry, so a resize measurement cannot toggle a user's choice.
 */
export const shouldAutoExpandGroup = ({
  documentHeight,
  expandedHeight,
  gap = DEFAULT_ANNOTATION_GAP,
  groupY,
  nextY,
}: AnnotationAutoExpandOptions): boolean => {
  if (
    !Number.isFinite(documentHeight) ||
    !Number.isFinite(expandedHeight) ||
    !Number.isFinite(groupY) ||
    expandedHeight < 0 ||
    groupY < 0
  ) {
    return false;
  }

  const expandedBottom = groupY + expandedHeight;
  if (expandedBottom > Math.max(0, documentHeight)) return false;
  if (nextY == null) return true;

  return Number.isFinite(nextY) && expandedBottom + Math.max(0, gap) <= nextY;
};

/** A remembered user choice always wins over the current geometric default. */
export const resolveAnnotationGroupExpansion = (
  autoExpanded: boolean,
  manualOverride?: boolean,
): boolean => manualOverride ?? autoExpanded;

interface PavaBlock {
  end: number;
  lower: number;
  mean: number;
  start: number;
  sum: number;
  upper: number;
  weight: number;
}

export type AnnotationScrollSource = 'editor' | 'rail';

export interface AnnotationScrollGuardState {
  activeSource: AnnotationScrollSource | null;
  token: number;
}

/** Stable one-dimensional epsilon grouping for records sharing an anchor. */
export const groupAnnotationMeasurements = (
  measurements: ReadonlyArray<AnnotationRailMeasurement>,
  epsilon = DEFAULT_ANNOTATION_GROUP_EPSILON,
): AnnotationRailGroup[] => {
  const safeEpsilon = Number.isFinite(epsilon) && epsilon >= 0 ? epsilon : 0;
  const sorted = measurements
    .filter((measurement) => measurement.record?.status !== 'orphaned')
    .map((measurement, index) => ({ index, measurement }))
    .sort((left, right) => {
      const anchorDelta = left.measurement.anchorY - right.measurement.anchorY;
      if (anchorDelta !== 0) return anchorDelta;
      const createdDelta = left.measurement.createdAt.localeCompare(right.measurement.createdAt);
      if (createdDelta !== 0) return createdDelta;
      const idDelta = left.measurement.id.localeCompare(right.measurement.id);
      return idDelta !== 0 ? idDelta : left.index - right.index;
    })
    .map(({ measurement }) => measurement);

  const groups: WorkingAnnotationRailGroup[] = [];

  for (const measurement of sorted) {
    const anchorGroupKey = normalizeAnchorGroupKey(measurement.anchorGroupKey);
    // A semantic block key is authoritative. In particular, do not let two
    // adjacent blocks collapse merely because their measured tops are close.
    const sameAnchorGroup = anchorGroupKey
      ? groups.find((group) => group.anchorGroupKey === anchorGroupKey)
      : undefined;
    const epsilonGroup = groups.find(
      (group) =>
        !anchorGroupKey &&
        !group.anchorGroupKey &&
        measurement.anchorY - group.lastAnchorY <= safeEpsilon,
    );
    const matchingGroup = sameAnchorGroup || epsilonGroup;

    if (matchingGroup) {
      matchingGroup.items.push(measurement);
      if (!matchingGroup.anchorGroupKey && anchorGroupKey) {
        matchingGroup.anchorGroupKey = anchorGroupKey;
      }
      matchingGroup.anchorY = Math.min(matchingGroup.anchorY, measurement.anchorY);
      matchingGroup.lastAnchorY = measurement.anchorY;
      matchingGroup.createdAt = [matchingGroup.createdAt, measurement.createdAt].sort()[0];
      continue;
    }

    groups.push({
      anchorY: measurement.anchorY,
      anchorGroupKey,
      createdAt: measurement.createdAt,
      id: getStableAnchorGroupId(measurement, safeEpsilon),
      items: [measurement],
      lastAnchorY: measurement.anchorY,
    });
  }

  return groups
    .map(({ lastAnchorY: _lastAnchorY, ...group }) => ({
      ...group,
      // A group can be promoted from node-key fallback to a semantic key when
      // the DOM becomes available after hydration. Recompute only from stable
      // geometry/key data, never from the first annotation id.
      id: getStableAnchorGroupId(group, safeEpsilon),
      items: [...group.items].sort((left, right) => {
        const createdDelta = left.createdAt.localeCompare(right.createdAt);
        return createdDelta !== 0 ? createdDelta : left.id.localeCompare(right.id);
      }),
    }))
    .sort(
      (left, right) =>
        left.anchorY - right.anchorY || left.createdAt.localeCompare(right.createdAt),
    );
};

/**
 * Variable-height VPSC/PAVA placement.
 *
 * Transforming `y[i] + height[i] + gap <= y[i + 1]` into isotonic constraints on
 * `z[i] = y[i] - prefix[i]` lets the pool-adjacent-violators algorithm minimize the
 * weighted squared displacement from each desired anchor. Bounds are folded into each
 * block before merging, so dense anchors are solved globally instead of by first-fit.
 */
export const layoutAnnotationRailItems = (
  desiredItems: ReadonlyArray<Omit<AnnotationRailLayoutItem, 'y'> & { desiredY?: number }>,
  options: AnnotationRailLayoutOptions,
): AnnotationRailLayoutResult => {
  const gap = Math.max(0, options.gap ?? DEFAULT_ANNOTATION_GAP);
  const sorted = [...desiredItems]
    .map((item, index) => ({ index, item }))
    .sort((left, right) => {
      const anchorDelta =
        (left.item.desiredY ?? left.item.anchorY) - (right.item.desiredY ?? right.item.anchorY);
      if (anchorDelta !== 0) return anchorDelta;
      const createdDelta = left.item.createdAt.localeCompare(right.item.createdAt);
      return createdDelta !== 0 ? createdDelta : left.index - right.index;
    })
    .map(({ item }) => ({ ...item, desiredY: Math.max(0, item.desiredY ?? item.anchorY) }));

  if (sorted.length === 0) {
    return { height: Math.max(0, options.documentHeight), items: [] };
  }

  const prefix: number[] = [];
  let requiredHeight = 0;
  for (const [index, item] of sorted.entries()) {
    prefix[index] = requiredHeight;
    requiredHeight += Math.max(0, item.height) + (index === sorted.length - 1 ? 0 : gap);
  }

  const height = Math.max(Math.max(0, options.documentHeight), requiredHeight);
  const blocks: PavaBlock[] = [];

  for (const [index, item] of sorted.entries()) {
    const desired = item.desiredY - prefix[index];
    const lower = -prefix[index];
    const upper = height - Math.max(0, item.height) - prefix[index];
    blocks.push({
      end: index,
      lower,
      mean: clamp(desired, lower, upper),
      start: index,
      sum: desired,
      upper,
      weight: 1,
    });

    while (blocks.length >= 2) {
      const previous = blocks.at(-2)!;
      const current = blocks.at(-1)!;
      if (previous.mean <= current.mean) break;

      blocks.splice(-2, 2, mergePavaBlocks(previous, current));
    }
  }

  const zValues: number[] = Array.from({ length: sorted.length });
  for (const block of blocks) {
    for (let index = block.start; index <= block.end; index++) zValues[index] = block.mean;
  }

  const items = sorted.map((item, index) => ({
    ...item,
    y: zValues[index] + prefix[index],
  }));

  return {
    height,
    items,
  };
};

export const initialAnnotationScrollGuardState: AnnotationScrollGuardState = {
  activeSource: null,
  token: 0,
};

export const beginAnnotationScrollSync = (
  state: AnnotationScrollGuardState,
  targetSource: AnnotationScrollSource,
): AnnotationScrollGuardState => ({
  // `targetSource` is the scroll event that the programmatic write will emit next. The
  // originating user event has already been handled and must not be guarded.
  activeSource: targetSource,
  token: state.token + 1,
});

export const finishAnnotationScrollSync = (
  state: AnnotationScrollGuardState,
  token: number,
): AnnotationScrollGuardState => (state.token === token ? { ...state, activeSource: null } : state);

export const shouldIgnoreAnnotationScroll = (
  state: AnnotationScrollGuardState,
  source: AnnotationScrollSource,
): boolean => state.activeSource === source;

function mergePavaBlocks(left: PavaBlock, right: PavaBlock): PavaBlock {
  const lower = Math.max(left.lower, right.lower);
  const upper = Math.min(left.upper, right.upper);
  const sum = left.sum + right.sum;
  const weight = left.weight + right.weight;
  return {
    end: right.end,
    lower,
    mean: clamp(sum / weight, lower, upper),
    start: left.start,
    sum,
    upper,
    weight,
  };
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(Math.max(value, lower), upper);
}
