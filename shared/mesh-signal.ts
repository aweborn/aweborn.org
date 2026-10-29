/**
 * Compact WebRTC signaling for the offline mesh (Phase 06, Rough Draft M7b).
 *
 * Two phones with no internet exchange one QR each (host → joiner, joiner → host).
 * A full SDP is 500–2,500 characters; a QR that dense is hard to scan. A
 * data-channel-only session needs just a handful of values, so we pack those
 * (in the spirit of QWBP) and rebuild a standard SDP on the other side:
 *
 *   version · flags · [world id] · ice-ufrag · ice-pwd · DTLS sha-256 fingerprint · ≤ 4 UDP candidates
 *
 * ≈ 70–130 bytes (119 for a real Chrome offer with two mDNS candidates + world id)
 * → ≤ 200 characters as the join URL: a QR version ~8–9, still easy to scan.
 * Candidates are host (IPv4, IPv6 or an mDNS `<uuid>.local` name) or srflx IPv4.
 * Nothing secret travels: the fingerprint pins the DTLS certificate, so a code
 * only connects the two phones that showed each other their screens.
 */

const VERSION = 1;
const MAX_CANDIDATES = 4;
const F_ANSWER = 1;
const F_SETUP_ACTIVE = 2; // answers only: active (else passive)
const F_WORLD = 4;

const C_HOST4 = 0;
const C_HOST6 = 1;
const C_MDNS = 2;
const C_SRFLX4 = 3;

/** The offer URL a phone camera can open (the app routes /j, M7c). */
export const MESH_JOIN_PATH = "/j";
/** Answers are plain text (not a URL), so a phone camera app never navigates away with one. */
export const MESH_ANSWER_PREFIX = "AWB1:";

export interface MeshCandidate {
  type: "host" | "srflx";
  address: string;
  port: number;
}

export interface MeshSignal {
  kind: "offer" | "answer";
  /** answers: "active" | "passive"; offers are always "actpass" */
  setup: "actpass" | "active" | "passive";
  ufrag: string;
  pwd: string;
  /** 32 bytes as AA:BB:… (sha-256) */
  fingerprint: string;
  candidates: MeshCandidate[];
  /** the world the host is in (offers) */
  worldId?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read the values we need out of a browser's data-channel SDP. Throws if it isn't one we can carry. */
export function parseSdp(sdp: string, kind: "offer" | "answer"): MeshSignal {
  const lines = sdp.split(/\r?\n/);
  const val = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim();
  const ufrag = val("a=ice-ufrag:");
  const pwd = val("a=ice-pwd:");
  const fp = val("a=fingerprint:");
  const setup = val("a=setup:");
  const mid = val("a=mid:");
  if (!ufrag || !pwd || !fp || !setup) throw new Error("SDP is missing ICE or DTLS values");
  if (mid !== undefined && mid !== "0") throw new Error(`unsupported mid ${mid}`);
  const [algo, hex] = fp.split(" ");
  if (algo?.toLowerCase() !== "sha-256" || !hex) throw new Error("fingerprint must be sha-256");
  if (kind === "offer" && setup !== "actpass") throw new Error("offer setup must be actpass");
  if (kind === "answer" && setup !== "active" && setup !== "passive") throw new Error("answer setup must be active/passive");
  const candidates: MeshCandidate[] = [];
  for (const l of lines) {
    if (!l.startsWith("a=candidate:")) continue;
    // foundation component transport priority address port typ type …
    const p = l.slice("a=candidate:".length).split(" ");
    if (p[1] !== "1" || p[2]?.toLowerCase() !== "udp") continue;
    const type = p[7];
    const address = p[4];
    const port = Number(p[5]);
    if (!address || !Number.isInteger(port) || port <= 0 || port > 65535) continue;
    if (type === "host" && (isIPv4(address) || isIPv6(address) || isMdns(address))) candidates.push({ type, address, port });
    else if (type === "srflx" && isIPv4(address)) candidates.push({ type, address, port });
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return { kind, setup: setup as MeshSignal["setup"], ufrag, pwd, fingerprint: hex.toUpperCase(), candidates };
}

/** A standard data-channel-only SDP from the carried values (what setRemoteDescription gets). */
export function buildSdp(s: MeshSignal): string {
  const lines = [
    "v=0",
    `o=- ${sessionId(s)} 2 IN IP4 127.0.0.1`,
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
  ];
  s.candidates.forEach((c, i) => {
    // RFC 8445 priority: type preference (host 126, srflx 100) · local preference · component 1
    const pref = (c.type === "host" ? 126 : 100) * 2 ** 24 + (65535 - i) * 2 ** 8 + 255;
    lines.push(`a=candidate:${i + 1} 1 udp ${pref} ${c.address} ${c.port} typ ${c.type}${c.type === "srflx" ? " raddr 0.0.0.0 rport 0" : ""} generation 0`);
  });
  if (s.candidates.length > 0) lines.push("a=end-of-candidates");
  lines.push(
    `a=ice-ufrag:${s.ufrag}`,
    `a=ice-pwd:${s.pwd}`,
    `a=fingerprint:sha-256 ${s.fingerprint}`,
    `a=setup:${s.setup}`,
    "a=mid:0",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
  );
  return lines.join("\r\n") + "\r\n";
}

/** Pack to bytes. */
export function encodeSignal(s: MeshSignal): Uint8Array {
  const out: number[] = [VERSION];
  let flags = 0;
  if (s.kind === "answer") flags |= F_ANSWER;
  if (s.kind === "answer" && s.setup === "active") flags |= F_SETUP_ACTIVE;
  if (s.worldId) {
    if (!UUID_RE.test(s.worldId)) throw new Error("world id must be a uuid");
    flags |= F_WORLD;
  }
  out.push(flags);
  if (s.worldId) out.push(...uuidBytes(s.worldId));
  pushStr(out, s.ufrag);
  pushStr(out, s.pwd);
  const fp = s.fingerprint.split(":").map((h) => parseInt(h, 16));
  if (fp.length !== 32 || fp.some((b) => !(b >= 0 && b <= 255))) throw new Error("bad fingerprint");
  out.push(...fp);
  const cands = s.candidates.slice(0, MAX_CANDIDATES);
  out.push(cands.length);
  for (const c of cands) {
    if (c.type === "srflx") out.push(C_SRFLX4, ...ipv4Bytes(c.address));
    else if (isIPv4(c.address)) out.push(C_HOST4, ...ipv4Bytes(c.address));
    else if (isMdns(c.address)) out.push(C_MDNS, ...uuidBytes(c.address.slice(0, 36)));
    else out.push(C_HOST6, ...ipv6Bytes(c.address));
    out.push((c.port >> 8) & 255, c.port & 255);
  }
  return Uint8Array.from(out);
}

/** Unpack bytes. Throws on anything malformed (a scan of some other QR, a truncated paste). */
export function decodeSignal(bytes: Uint8Array): MeshSignal {
  let i = 0;
  const need = (n: number) => {
    if (i + n > bytes.length) throw new Error("code is too short");
  };
  const take = (n: number) => {
    need(n);
    const v = bytes.subarray(i, i + n);
    i += n;
    return v;
  };
  const str = () => {
    const n = take(1)[0]!;
    if (n === 0 || n > 64) throw new Error("bad string length");
    const v = take(n);
    for (const ch of v) if (ch < 0x21 || ch > 0x7e) throw new Error("bad characters");
    return String.fromCharCode(...v);
  };
  if (take(1)[0] !== VERSION) throw new Error("not an Aweborn code (or a newer version)");
  const flags = take(1)[0]!;
  const kind = flags & F_ANSWER ? "answer" : "offer";
  const worldId = flags & F_WORLD ? uuidString(take(16)) : undefined;
  const ufrag = str();
  const pwd = str();
  const fingerprint = [...take(32)].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
  const n = take(1)[0]!;
  if (n > MAX_CANDIDATES) throw new Error("too many candidates");
  const candidates: MeshCandidate[] = [];
  for (let k = 0; k < n; k++) {
    const t = take(1)[0];
    let address: string;
    let type: MeshCandidate["type"] = "host";
    if (t === C_HOST4 || t === C_SRFLX4) {
      address = [...take(4)].join(".");
      if (t === C_SRFLX4) type = "srflx";
    } else if (t === C_MDNS) address = `${uuidString(take(16))}.local`;
    else if (t === C_HOST6) address = ipv6String(take(16));
    else throw new Error("bad candidate type");
    const pb = take(2);
    const port = (pb[0]! << 8) | pb[1]!;
    if (port === 0) throw new Error("bad port");
    candidates.push({ type, address, port });
  }
  if (i !== bytes.length) throw new Error("trailing bytes");
  const setup = kind === "offer" ? "actpass" : flags & F_SETUP_ACTIVE ? "active" : "passive";
  return { kind, setup, ufrag, pwd, fingerprint, candidates, ...(worldId ? { worldId } : {}) };
}

// ── text forms ──

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error("not a code");
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Offer → `https://aweborn.org/j#<code>`; answer → `AWB1:<code>`. */
export function signalToText(s: MeshSignal, origin: string): string {
  const code = toBase64Url(encodeSignal(s));
  return s.kind === "offer" ? `${origin}${MESH_JOIN_PATH}#${code}` : `${MESH_ANSWER_PREFIX}${code}`;
}

/** Accepts anything a scan or paste may give: the offer URL, a bare code, or the answer text. */
export function textToSignal(text: string): MeshSignal {
  let t = text.trim();
  if (t.startsWith(MESH_ANSWER_PREFIX)) t = t.slice(MESH_ANSWER_PREFIX.length);
  else {
    const hash = t.indexOf("#");
    if (hash >= 0) t = t.slice(hash + 1);
  }
  if (t.length > 400) throw new Error("code is too long");
  return decodeSignal(fromBase64Url(t));
}

// ── helpers ──

function sessionId(s: MeshSignal): string {
  // stable per code, digits only (o= line)
  let h = 0;
  for (const ch of s.ufrag + s.pwd) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return String(h || 1);
}

function pushStr(out: number[], s: string): void {
  if (s.length === 0 || s.length > 64 || !/^[\x21-\x7e]+$/.test(s)) throw new Error("bad ICE string");
  out.push(s.length);
  for (const ch of s) out.push(ch.charCodeAt(0));
}

function isIPv4(a: string): boolean {
  const p = a.split(".");
  return p.length === 4 && p.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255);
}

function isIPv6(a: string): boolean {
  return a.includes(":") && /^[0-9a-f:]+$/i.test(a) && (a.match(/::/g)?.length ?? 0) <= 1;
}

function isMdns(a: string): boolean {
  return a.length === 42 && a.toLowerCase().endsWith(".local") && UUID_RE.test(a.slice(0, 36));
}

function ipv4Bytes(a: string): number[] {
  return a.split(".").map(Number);
}

function ipv6Bytes(a: string): number[] {
  const [head, tail] = a.includes("::") ? a.split("::") : [a, undefined];
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  if (groups.length !== 8) throw new Error("bad IPv6");
  return groups.flatMap((g) => {
    const v = parseInt(g || "0", 16);
    return [(v >> 8) & 255, v & 255];
  });
}

function ipv6String(b: Uint8Array): string {
  const groups: string[] = [];
  for (let k = 0; k < 16; k += 2) groups.push(((b[k]! << 8) | b[k + 1]!).toString(16));
  return groups.join(":");
}

function uuidBytes(u: string): number[] {
  const hex = u.replace(/-/g, "");
  const out: number[] = [];
  for (let k = 0; k < 32; k += 2) out.push(parseInt(hex.slice(k, k + 2), 16));
  return out;
}

function uuidString(b: Uint8Array): string {
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
