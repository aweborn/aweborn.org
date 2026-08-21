import { useEffect, useState, useCallback, useMemo } from "react";
import { useSyncConnection } from "../hooks/useCRDT";
import { usePresence } from "../hooks/usePresence";
import { useUniverseStore } from "../stores/universeStore";
import { useWorldStore } from "../stores/worldStore";
import type { WorldEntry } from "@aweborn/shared/crdt-schema";
import { adjacentSectorKeys } from "@aweborn/shared/crdt-schema";

/**
 * Dev Multiplayer Overlay — floating panel for testing Phase 02.
 *
 * Shows connection status, synced worlds, active players, and provides
 * buttons for creating/entering worlds, placing objects, and chatting.
 *
 * Press ` (backtick) to toggle visibility.
 * Only shown in development mode.
 */
export function CRDTDevOverlay() {
  const [visible, setVisible] = useState(true);
  const [worldName, setWorldName] = useState("");
  const [worldColor, setWorldColor] = useState("#ff7b54");
  const [chatInput, setChatInput] = useState("");

  // Store state
  const worlds = useUniverseStore((s) => s.worlds);
  const activeWorldId = useUniverseStore((s) => s.activeWorldId);
  const activeWorldDoc = useUniverseStore((s) => s.activeWorldDoc);
  const applyUniverseUpdate = useUniverseStore((s) => s.applyUniverseUpdate);
  const applyWorldUpdate = useUniverseStore((s) => s.applyWorldUpdate);
  const enterWorld = useUniverseStore((s) => s.enterWorld);
  const exitWorld = useUniverseStore((s) => s.exitWorld);
  const setWorldDocUpdateHandler = useUniverseStore((s) => s.setWorldDocUpdateHandler);

  // World interior state
  const worldObjects = useWorldStore((s) => s.objects);
  const worldChat = useWorldStore((s) => s.chat);
  const worldLoaded = useWorldStore((s) => s.loaded);
  const placeObject = useWorldStore((s) => s.placeObject);
  const sendChat = useWorldStore((s) => s.sendChat);
  const resetWorld = useWorldStore((s) => s.reset);

  // Presence
  const { playerId, playerColor, players } = usePresence();

  // Default sector keys (centered at origin)
  const sectorKeys = useMemo(
    () => adjacentSectorKeys({ sx: 0, sy: 0, sz: 0 }),
    []
  );

  // Sync connection
  const onUniverseUpdate = useCallback(
    (type: string, data: Uint8Array) => {
      applyUniverseUpdate(data, type === "universe-sync");
    },
    [applyUniverseUpdate]
  );

  const onWorldUpdate = useCallback(
    (type: string, worldId: string, data: Uint8Array) => {
      applyWorldUpdate(worldId, data, type === "world-sync");
    },
    [applyWorldUpdate]
  );

  const { connected, send, createWorld, joinWorld: syncJoinWorld, leaveWorld: syncLeaveWorld } = useSyncConnection(
    sectorKeys,
    onUniverseUpdate,
    onWorldUpdate
  );

  // Wire world doc update handler: send local world changes to the server
  useEffect(() => {
    setWorldDocUpdateHandler((worldId: string, update: Uint8Array) => {
      send("world-update", update, worldId);
    });
    return () => setWorldDocUpdateHandler(null);
  }, [send, setWorldDocUpdateHandler]);

  // Toggle with backtick key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "`") setVisible((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleCreateWorld = () => {
    if (!worldName.trim()) return;
    // Random position near origin for dev testing
    const position = {
      x: (Math.random() - 0.5) * 500,
      y: (Math.random() - 0.5) * 200,
      z: (Math.random() - 0.5) * 500,
    };
    createWorld(worldName.trim(), playerId, position, worldColor);
    setWorldName("");
  };

  const handleEnterWorld = (worldId: string) => {
    enterWorld(worldId);
    // Tell server to join the world room via multiplexed protocol
    syncJoinWorld(worldId);
  };

  const handleExitWorld = () => {
    if (activeWorldId) {
      syncLeaveWorld(activeWorldId);
    }
    exitWorld();
    resetWorld();
  };

  const handlePlaceObject = () => {
    if (!activeWorldDoc) return;
    const position = {
      x: (Math.random() - 0.5) * 20,
      y: Math.random() * 5,
      z: (Math.random() - 0.5) * 20,
    };
    const types = ["cube", "sphere", "cylinder", "cone", "torus"];
    const type = types[Math.floor(Math.random() * types.length)];
    placeObject(activeWorldDoc, type, position);
  };

  const handleSendChat = () => {
    if (!activeWorldDoc || !chatInput.trim()) return;
    sendChat(activeWorldDoc, playerId, chatInput.trim());
    setChatInput("");
  };

  if (!visible) return null;

  const worldsList = Array.from(worlds.values());

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>🌌 Multiplayer Dev</span>
        <span style={styles.status}>
          {connected ? "🟢" : "🔴"} {connected ? "connected" : "disconnected"}
        </span>
        <button onClick={() => setVisible(false)} style={styles.closeBtn} title="Close (`)">
          ×
        </button>
      </div>

      {/* Player info */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>You</div>
        <div style={styles.playerBadge}>
          <span style={{ ...styles.dot, background: playerColor }} />
          <span style={styles.playerId}>{playerId}</span>
          {activeWorldId && (
            <span style={styles.inWorld}>in: {activeWorldId}</span>
          )}
        </div>
      </div>

      {/* Other players */}
      {players.size > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Players ({players.size})</div>
          {Array.from(players.values()).map((p) => (
            <div key={p.id} style={styles.playerBadge}>
              <span style={{ ...styles.dot, background: p.color }} />
              <span style={styles.playerId}>{p.id}</span>
              {p.inWorld && <span style={styles.inWorld}>in: {p.inWorld}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Worlds list */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Worlds ({worldsList.length})</div>
        {worldsList.length === 0 ? (
          <div style={styles.empty}>No worlds yet</div>
        ) : (
          <div style={styles.worldsList}>
            {worldsList.map((w) => (
              <WorldCard
                key={w.id}
                world={w}
                isActive={w.id === activeWorldId}
                onEnter={() => handleEnterWorld(w.id)}
                onExit={handleExitWorld}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create world */}
      {!activeWorldId && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Create World</div>
          <div style={styles.form}>
            <input
              style={styles.input}
              placeholder="World name..."
              value={worldName}
              onChange={(e) => setWorldName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateWorld()}
            />
            <input
              type="color"
              value={worldColor}
              onChange={(e) => setWorldColor(e.target.value)}
              style={styles.colorPicker}
            />
            <button onClick={handleCreateWorld} style={styles.createBtn}>
              + Create
            </button>
          </div>
        </div>
      )}

      {/* World Interior UI */}
      {activeWorldId && worldLoaded && (
        <>
          {/* Objects in world */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>
              Objects ({worldObjects.size})
              <button onClick={handlePlaceObject} style={styles.placeBtn}>
                + Place Random
              </button>
            </div>
            {worldObjects.size === 0 ? (
              <div style={styles.empty}>No objects yet — place one!</div>
            ) : (
              <div style={styles.objectsList}>
                {Array.from(worldObjects.values()).slice(-8).map((obj) => (
                  <div key={obj.id} style={styles.objectItem}>
                    <span style={styles.objectType}>{obj.type}</span>
                    <span style={styles.objectPos}>
                      ({obj.x.toFixed(1)}, {obj.y.toFixed(1)}, {obj.z.toFixed(1)})
                    </span>
                    <span style={styles.objectId}>{obj.id}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Chat */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Chat</div>
            <div style={styles.chatBox}>
              {worldChat.length === 0 ? (
                <div style={styles.empty}>No messages yet</div>
              ) : (
                worldChat.slice(-5).map((msg, i) => (
                  <div key={i} style={styles.chatMsg}>
                    <span style={styles.chatSender}>{msg.sender.slice(0, 6)}:</span>
                    <span>{msg.text}</span>
                  </div>
                ))
              )}
            </div>
            <div style={styles.form}>
              <input
                style={styles.input}
                placeholder="Say something..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
              />
              <button onClick={handleSendChat} style={styles.createBtn}>
                Send
              </button>
            </div>
          </div>
        </>
      )}

      <div style={styles.hint}>Press ` to toggle</div>
    </div>
  );
}

// ── World Card Sub-component ─────────────────────────────────────────

function WorldCard({
  world,
  isActive,
  onEnter,
  onExit,
}: {
  world: WorldEntry;
  isActive: boolean;
  onEnter: () => void;
  onExit: () => void;
}) {
  const pos = world.resolvedPosition;
  return (
    <div
      style={{
        ...styles.worldCard,
        borderColor: isActive ? world.color : "rgba(255,255,255,0.1)",
      }}
    >
      <div style={styles.worldHeader}>
        <span style={{ ...styles.worldDot, background: world.color }} />
        <span style={styles.worldName}>{world.name}</span>
        <span style={styles.worldId}>{world.id}</span>
      </div>
      <div style={styles.worldMeta}>
        pos: ({pos.x.toFixed(0)}, {pos.y.toFixed(0)}, {pos.z.toFixed(0)})
        {world.solidified ? " · ✨ solid" : " · 👻 ghost"}
        {world.playerCount > 0 && ` · ${world.playerCount} 👤`}
      </div>
      {isActive ? (
        <button onClick={onExit} style={styles.exitBtn}>
          ← Exit World
        </button>
      ) : (
        <button onClick={onEnter} style={styles.enterBtn}>
          Enter →
        </button>
      )}
    </div>
  );
}

// ── Inline styles ────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    bottom: 16,
    right: 16,
    width: 340,
    background: "rgba(0, 0, 0, 0.9)",
    backdropFilter: "blur(16px)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 14,
    padding: 14,
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: 12,
    color: "#e0e0e0",
    zIndex: 9999,
    maxHeight: 600,
    overflow: "auto",
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
    paddingBottom: 8,
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
  title: { fontWeight: 700, fontSize: 14, color: "#fff" },
  status: { flex: 1, fontSize: 11, opacity: 0.7, textAlign: "right" as const },
  closeBtn: {
    background: "none",
    border: "none",
    color: "#666",
    fontSize: 18,
    cursor: "pointer",
    padding: 0,
    lineHeight: 1,
  },
  section: { marginBottom: 10 },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "#888",
    marginBottom: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  playerBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 0",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  playerId: { fontSize: 11, color: "#ccc" },
  inWorld: { fontSize: 10, color: "#888", marginLeft: "auto" },
  worldsList: { display: "flex", flexDirection: "column" as const, gap: 6 },
  worldCard: {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    padding: 8,
  },
  worldHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  worldDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    flexShrink: 0,
    boxShadow: "0 0 6px currentColor",
  },
  worldName: { fontWeight: 600, fontSize: 12, color: "#fff" },
  worldId: { fontSize: 10, color: "#666", marginLeft: "auto" },
  worldMeta: { fontSize: 10, color: "#888", marginBottom: 6 },
  enterBtn: {
    background: "rgba(100, 200, 255, 0.15)",
    border: "1px solid rgba(100, 200, 255, 0.3)",
    borderRadius: 5,
    color: "#6cf",
    fontSize: 11,
    cursor: "pointer",
    padding: "3px 10px",
    width: "100%",
  },
  exitBtn: {
    background: "rgba(255, 100, 100, 0.15)",
    border: "1px solid rgba(255, 100, 100, 0.3)",
    borderRadius: 5,
    color: "#f88",
    fontSize: 11,
    cursor: "pointer",
    padding: "3px 10px",
    width: "100%",
  },
  empty: { fontSize: 11, color: "#666", fontStyle: "italic" as const },
  form: { display: "flex", gap: 4 },
  input: {
    flex: 1,
    background: "rgba(255, 255, 255, 0.06)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    borderRadius: 5,
    padding: "5px 8px",
    color: "#fff",
    fontSize: 11,
    outline: "none",
  },
  colorPicker: {
    width: 28,
    height: 28,
    border: "none",
    borderRadius: 5,
    cursor: "pointer",
    padding: 0,
  },
  createBtn: {
    background: "rgba(120, 255, 120, 0.15)",
    border: "1px solid rgba(120, 255, 120, 0.3)",
    borderRadius: 5,
    color: "#8f8",
    fontSize: 11,
    cursor: "pointer",
    padding: "3px 10px",
    whiteSpace: "nowrap" as const,
  },
  placeBtn: {
    background: "rgba(200, 160, 255, 0.15)",
    border: "1px solid rgba(200, 160, 255, 0.3)",
    borderRadius: 4,
    color: "#c8a0ff",
    fontSize: 9,
    cursor: "pointer",
    padding: "2px 6px",
  },
  objectsList: { display: "flex", flexDirection: "column" as const, gap: 2 },
  objectItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "2px 0",
    fontSize: 10,
  },
  objectType: {
    background: "rgba(200, 160, 255, 0.15)",
    borderRadius: 3,
    padding: "1px 4px",
    color: "#c8a0ff",
    fontSize: 9,
    fontWeight: 600,
  },
  objectPos: { color: "#888", fontSize: 9 },
  objectId: { color: "#555", fontSize: 9, marginLeft: "auto" },
  chatBox: {
    maxHeight: 80,
    overflow: "auto",
    marginBottom: 4,
    padding: 4,
    background: "rgba(255,255,255,0.02)",
    borderRadius: 4,
  },
  chatMsg: { fontSize: 10, padding: "1px 0" },
  chatSender: { color: "#6cf", fontWeight: 600, marginRight: 4 },
  hint: {
    textAlign: "center" as const,
    fontSize: 10,
    opacity: 0.3,
    marginTop: 6,
  },
};
