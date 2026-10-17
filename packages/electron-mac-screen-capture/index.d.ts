export interface ScreenCaptureFrame {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface ScreenCaptureDisplay {
  displayID: number;
  /** Frame in points, in the global top-left coordinate space. */
  frame: ScreenCaptureFrame;
  isPrimary: boolean;
  /** Backing pixels per point. */
  scaleFactor: number;
}

export interface ScreenCaptureWindow {
  appName: string;
  bundleId: string;
  /** Frame in points, in the global top-left coordinate space. */
  frame: ScreenCaptureFrame;
  isOnScreen: boolean;
  layer: number;
  pid: number;
  title: string;
  windowID: number;
}

export interface ScreenCaptureContent {
  displays: ScreenCaptureDisplay[];
  windows: ScreenCaptureWindow[];
}

export type CapturePermissionStatus = 'denied' | 'granted' | 'unknown';

/**
 * Why a capture produced no image.
 *
 * `denied` is the one the caller has to interpret: on macOS 15 and newer the
 * first direct capture needs a one-time consent ("bypass the system window
 * picker"), and until the user accepts it ScreenCaptureKit refuses exactly like
 * a refused permission. Only the caller knows whether the permission itself is
 * granted, so it alone can tell "waiting for consent" from "not granted".
 */
export type CaptureFailure =
  | 'denied'
  | 'failed'
  | 'not-found'
  | 'timeout'
  | 'unsupported';

export interface CaptureOutcome {
  png: Buffer | null;
  reason: CaptureFailure | null;
}

/** Whether ScreenCaptureKit can produce stills on this macOS version. */
export function isSupported(): boolean;
/**
 * Screen Recording as ScreenCaptureKit sees it, with no system prompt. `null`
 * when the native module is unavailable.
 */
export function probeCapturePermission(): CapturePermissionStatus | null;
/** Displays and windows, or `null` when ScreenCaptureKit cannot answer. */
export function screenShareableContent(): ScreenCaptureContent | null;
/** One window at native pixel resolution, or a reason. */
export function captureWindow(windowId: number): Promise<CaptureOutcome>;
/** A region in global points, at native pixel resolution, or a reason. */
export function captureRect(rect: ScreenCaptureFrame): Promise<CaptureOutcome>;
