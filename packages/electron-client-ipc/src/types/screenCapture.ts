export interface ScreenCaptureWindowInfo {
  appName: string;
  bounds: { height: number; width: number; x: number; y: number };
  order: number;
  overlayBounds: { height: number; width: number; x: number; y: number };
  title: string;
  windowId: number;
}

/**
 * Lightweight agent descriptor for the overlay selector.
 * Populated by the renderer data layer (TRPC), not the IPC service.
 */
export interface ScreenCaptureAgentOption {
  avatar?: string | null;
  backgroundColor?: string | null;
  id: string;
  title: string;
}

/**
 * Lightweight model descriptor for the overlay selector.
 * Populated by the renderer data layer (TRPC), not the IPC service.
 */
export interface ScreenCaptureModelOption {
  displayName?: string | null;
  id: string;
  provider: string;
}

export interface ScreenCaptureOverlayTheme {
  colorBgElevated: string;
  colorBorderSecondary: string;
  colorFill: string;
  colorFillQuaternary: string;
  colorFillSecondary: string;
  colorFillTertiary: string;
  colorPrimary: string;
  colorPrimaryActive: string;
  colorPrimaryHover: string;
  colorText: string;
  colorTextLightSolid: string;
  colorTextQuaternary: string;
  colorTextSecondary: string;
  colorTextTertiary: string;
  panelBorder: string;
  panelShadow: string;
}

export interface ScreenCaptureSession {
  /** Optional agent list; overlay may still render with empty list. */
  agents?: ScreenCaptureAgentOption[];
  defaultAgentId?: string;
  defaultModelId?: string;
  defaultProvider?: string;
  displayBounds: { height: number; width: number; x: number; y: number };
  /** Optional model list. */
  models?: ScreenCaptureModelOption[];
  scaleFactor: number;
  theme?: ScreenCaptureOverlayTheme;
  windows: ScreenCaptureWindowInfo[];
}

/**
 * Rect in overlay-local DIP coordinates (relative to the current display).
 * Main-side translation to absolute coords is the caller's responsibility
 * where absolute geometry is required (see ScreenCaptureManager.handlePreviewRect).
 */
export interface CaptureRectParams {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface CapturePreviewResult {
  /**
   * Unique identifier assigned by the main process for this capture. The
   * main process immediately dispatches the PNG bytes to the main renderer
   * for upload; the overlay uses this id to track upload status and to
   * reference the uploaded file on submit.
   */
  captureId?: string;
  dataUrl?: string;
  error?: string;
  /** Overlay-local DIP rect. */
  rect?: CaptureRectParams;
  success: boolean;
}

export interface ScreenCaptureSubmitParams {
  agentId?: string;
  /**
   * Identifiers of captures that were pre-uploaded during preview. The main
   * renderer looks them up against its `captureId → UploadFileItem` map and
   * dispatches `sendMessage` with the resolved files.
   */
  captureIds: string[];
  modelId?: string;
  prompt: string;
  provider?: string;
}

export type OverlayCaptureUploadStatus = 'uploading' | 'ready' | 'failed';

/**
 * Sent by the main process to the main renderer whenever a new capture is
 * ready. The renderer should upload the bytes through the normal file
 * pipeline and keep the mapping `captureId → UploadFileItem` so that a later
 * `overlayDispatchMessage` (submit) can send without re-uploading.
 */
export interface OverlayUploadRequestPayload {
  bytes: ArrayBuffer;
  captureId: string;
  filename: string;
  mimeType: string;
}

/**
 * Sent by the main process to the overlay whenever a capture's upload
 * status transitions. The overlay uses this to toggle the send button.
 */
export interface OverlayCaptureUploadStatusPayload {
  captureId: string;
  fileId?: string;
  status: OverlayCaptureUploadStatus;
}
