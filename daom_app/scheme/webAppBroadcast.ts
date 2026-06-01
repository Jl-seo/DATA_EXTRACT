export interface WebAppBroadcastReset {
  type: 'reset-env-cache';
  id: string;
}

export type WebAppBroadcastMessage = WebAppBroadcastReset;
