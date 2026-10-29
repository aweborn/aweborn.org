import { useSyncExternalStore } from "react";
import { pendingWorldCount, subscribePendingWorlds } from "../lib/offlineCache";

/**
 * Connectivity tier for the HUD chip (Phase 06 "Tiered Connectivity UI", Rough Draft M7a).
 *
 * - online: the room socket to the VPS is up (no chip: silence means all is well)
 * - reconnecting: the browser has a network but the socket is down (deploy restart, Wi-Fi hop)
 * - solo: the browser says there's no network at all; play continues on the device cache
 * - mesh: no server, but nearby phones are linked (Play nearby, M7b)
 */
export type ConnectivityTier = "online" | "reconnecting" | "mesh" | "solo";

export function connectivityTier(connected: boolean, online: boolean, meshPeers = 0): ConnectivityTier {
  if (connected) return "online";
  if (meshPeers > 0) return "mesh";
  return online ? "reconnecting" : "solo";
}

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** navigator.onLine, live. `false` is reliable (no network); `true` only means "some network". */
export function useNavigatorOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** How many worlds hold edits made offline that the server hasn't got yet. */
export function usePendingWorlds(): number {
  return useSyncExternalStore(subscribePendingWorlds, pendingWorldCount, () => 0);
}
