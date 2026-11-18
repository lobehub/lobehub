import type { ReactNode } from 'react';

import type { GoalGraphView } from '../goalGraphViewModel';
import type { GraphBridge } from './layout';

export interface GraphProps {
  /**
   * Schematic links the host adds for a route through nodes it left off the
   * map — a report chapter joining a detour to where it forked.
   */
  bridges?: GraphBridge[];
  /** Header actions after the legend — e.g. a host without fullscreen links out to the goal page. */
  extra?: ReactNode;
  /**
   * Fullscreen is owned by the page: the overlay replaces the page's Portal
   * panel with its own, and only the owner can keep exactly one of the two
   * mounted at a time. A host that cannot give up its panel (the Portal itself)
   * omits `onFullscreenChange`, and the map stays inline.
   */
  fullscreen?: boolean;
  /**
   * Host panel docked beside the fullscreen map — the page's Portal, so node
   * drill-down keeps working over the overlay. Absent for a host with no drill-down.
   */
  fullscreenAside?: ReactNode;
  graph: GoalGraphView;
  /** Nodes to call out on the map — a chapter's detours in the report's local map. */
  highlightedIds?: ReadonlySet<string>;
  /**
   * Whether the report's mainline starts highlighted. Off by default, so a
   * finished Goal reads as the plain map until 主线 is clicked in the legend;
   * a report chapter, which is about the mainline, turns it on.
   */
  initialShowMainline?: boolean;
  onFullscreenChange?: (fullscreen: boolean) => void;
  /** Opens an experiment's own view. Absent when the host has nowhere to inspect it. */
  onInspect?: (nodeId: string) => void;
  onSelect: (nodeId: string) => void;
  /** The coordinator is still decomposing: show ghost task cards under the problem. */
  planning?: boolean;
  /** Bump after the frame around the canvas changes size to keep the selection in view. */
  refitKey?: boolean;
  selectedId?: string;
}
