export interface ZoomChangedPayload {
  factor: number;
  level: number;
}

export interface ZoomBroadcastEvents {
  'zoom:changed': (payload: ZoomChangedPayload) => void;
}
