import { useEffect, useState } from "react";
import { useCRDT } from "../hooks/useCRDT";

/**
 * Temporary dev overlay — shows CRDT connection status and shared state.
 * Remove once Phase 02 (Multiplayer Core) is underway.
 *
 * Press ` (backtick) to toggle visibility.
 */
export function CRDTDevOverlay() {
  const { doc, connected, synced } = useCRDT({ room: "dev-test" });
  const [visible, setVisible] = useState(true);
  const [mapState, setMapState] = useState<Record<string, unknown>>({});
  const [inputKey, setInputKey] = useState("");
  const [inputValue, setInputValue] = useState("");

  // Toggle with backtick key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "`") setVisible((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Observe the shared Y.Map
  useEffect(() => {
    if (!doc) return;

    const sharedMap = doc.getMap("dev");

    const updateState = () => {
      setMapState(Object.fromEntries(sharedMap.entries()));
    };

    sharedMap.observe(updateState);
    updateState();

    return () => {
      sharedMap.unobserve(updateState);
    };
  }, [doc]);

  const handleAdd = () => {
    if (!doc || !inputKey.trim()) return;
    const sharedMap = doc.getMap("dev");
    sharedMap.set(inputKey.trim(), inputValue);
    setInputKey("");
    setInputValue("");
  };

  const handleDelete = (key: string) => {
    if (!doc) return;
    const sharedMap = doc.getMap("dev");
    sharedMap.delete(key);
  };

  if (!visible) return null;

  const statusDot = connected ? "🟢" : "🔴";
  const syncLabel = synced ? "synced" : "syncing…";

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>CRDT Dev</span>
        <span style={styles.status}>
          {statusDot} {connected ? "connected" : "disconnected"} · {syncLabel}
        </span>
        <button
          onClick={() => setVisible(false)}
          style={styles.closeBtn}
          title="Close (or press backtick)"
        >
          ×
        </button>
      </div>

      {/* Shared state dump */}
      <pre style={styles.json}>
        {Object.keys(mapState).length > 0
          ? JSON.stringify(mapState, null, 2)
          : "(empty map)"}
      </pre>

      {/* Quick add form */}
      <div style={styles.form}>
        <input
          style={styles.input}
          placeholder="key"
          value={inputKey}
          onChange={(e) => setInputKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <input
          style={styles.input}
          placeholder="value"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <button onClick={handleAdd} style={styles.addBtn}>
          +
        </button>
      </div>

      {/* Entries with delete */}
      {Object.entries(mapState).map(([k]) => (
        <div key={k} style={styles.entry}>
          <span style={styles.entryKey}>{k}</span>
          <button onClick={() => handleDelete(k)} style={styles.delBtn}>
            ×
          </button>
        </div>
      ))}

      <div style={styles.hint}>Press ` to toggle</div>
    </div>
  );
}

// ── Inline styles (dev-only component, no CSS file needed) ───────────
const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    bottom: 16,
    right: 16,
    width: 300,
    background: "rgba(0, 0, 0, 0.85)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: 12,
    padding: 12,
    fontFamily: "'Inter', monospace",
    fontSize: 12,
    color: "#e0e0e0",
    zIndex: 9999,
    maxHeight: 400,
    overflow: "auto",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontWeight: 700,
    fontSize: 13,
    color: "#fff",
  },
  status: {
    flex: 1,
    fontSize: 11,
    opacity: 0.7,
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "#888",
    fontSize: 16,
    cursor: "pointer",
    padding: 0,
    lineHeight: 1,
  },
  json: {
    background: "rgba(255, 255, 255, 0.05)",
    borderRadius: 6,
    padding: 8,
    margin: "4px 0",
    fontSize: 11,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    maxHeight: 160,
    overflow: "auto",
  },
  form: {
    display: "flex",
    gap: 4,
    margin: "6px 0",
  },
  input: {
    flex: 1,
    background: "rgba(255, 255, 255, 0.08)",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    borderRadius: 4,
    padding: "4px 6px",
    color: "#fff",
    fontSize: 11,
    outline: "none",
  },
  addBtn: {
    background: "rgba(100, 200, 255, 0.2)",
    border: "1px solid rgba(100, 200, 255, 0.3)",
    borderRadius: 4,
    color: "#6cf",
    fontSize: 14,
    cursor: "pointer",
    padding: "2px 8px",
  },
  entry: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "2px 0",
  },
  entryKey: {
    fontSize: 11,
    color: "#aaa",
  },
  delBtn: {
    background: "none",
    border: "none",
    color: "#f66",
    cursor: "pointer",
    fontSize: 13,
    padding: 0,
  },
  hint: {
    textAlign: "center" as const,
    fontSize: 10,
    opacity: 0.4,
    marginTop: 6,
  },
};
