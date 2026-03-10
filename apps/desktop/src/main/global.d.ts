import 'vite/client';

/**
 * `node-mac-permissions` is a macOS-only native module.
 *
 * In Windows/Linux environments the dependency may be omitted (installed as an optional dependency),
 * but we still need a module declaration so TypeScript can compile.
 */
declare module 'node-mac-permissions' {
  export type AuthStatus = 'authorized' | 'denied' | 'not determined' | 'restricted';

  export type AuthType =
    | 'accessibility'
    | 'calendar'
    | 'camera'
    | 'contacts'
    | 'full-disk-access'
    | 'input-monitoring'
    | 'location'
    | 'microphone'
    | 'reminders'
    | 'screen'
    | 'speech-recognition';

  export function getAuthStatus(type: AuthType): AuthStatus;

  export function askForAccessibilityAccess(): void;
  export function askForMicrophoneAccess(): Promise<AuthStatus>;
  export function askForCameraAccess(): Promise<AuthStatus>;
  export function askForScreenCaptureAccess(openPreferences?: boolean): void;
  export function askForFullDiskAccess(): void;
}

export {};
