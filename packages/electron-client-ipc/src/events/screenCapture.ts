import type {
  OverlayCaptureUploadStatusPayload,
  OverlayUploadRequestPayload,
  ScreenCaptureSession,
  ScreenCaptureSubmitParams,
} from '../types/screenCapture';

/**
 * Payload broadcast to the main renderer when the overlay submits a screenshot
 * with a prompt. The main renderer is responsible for focusing the intended
 * agent session and sending the message through the chat store.
 */
export interface OverlayDispatchMessagePayload extends ScreenCaptureSubmitParams {}

export interface ScreenCaptureBroadcastEvents {
  overlayCaptureUploadStatus: (payload: OverlayCaptureUploadStatusPayload) => void;
  overlayDispatchMessage: (payload: OverlayDispatchMessagePayload) => void;
  overlayUploadRequest: (payload: OverlayUploadRequestPayload) => void;
  screenCaptureSession: (data: ScreenCaptureSession) => void;
}
