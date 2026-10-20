#!/usr/bin/env node
/**
 * Aweborn load test: headless bots that speak the real sync-service protocol.
 *
 * Card Event Readiness, step 1 (phases/README → Active Phase). Simulates a room
 * of people tapping cards: each bot (optionally) signs in anonymously, opens
 * /universe, flies around Origin sending presence at 20 Hz like the client
 * (src/hooks/usePresence.ts), and can enter a world and chat.
 *
 * NEVER point this at prod. Use local docker compose or a throwaway VPS copy.
 *
 *   node scripts/loadtest/bots.mjs --url http://localhost:1234 --stages 10,25,50,100 --hold 30
 *   node scripts/loadtest/bots.mjs --url https://<throwaway> --auth --world <worldId> --chat 20
 *
 * Options
 *   --url <http(s)://host:port>   sync-service base (ws URL is derived)       [http://localhost:1234]
 *   --stages 10,25,50,100,200     bot counts, ramped in order                  [10,25,50,100]
 *   --hold <s>                    seconds measured at each stage               [30]
 *   --ramp <s>                    seconds to add bots for a stage              [10]
 *   --hz <n>                      presence rate per bot (client sends 10 Hz)   [10]
 *   --auth                        sign each bot in anonymously first (tests the per-IP limit)
 *   --world <id>                  bots enter this world after connecting
 *   --chat <s>                    each bot chats every <s> seconds (needs --auth; in --world, else space chat)
 *   --workers <n>                 bot processes (receiving is O(n²): spread it) [cpus - 1]
 *   --docker <container>          sample `docker stats` for the server each stage
 *   --origin <url>                Origin header (must be trusted for cookies)  [http://localhost:5173]
 *   --json <file>                 also write the stage results as JSON
 *
 * What it reports per stage: bots connected, connect time, presence sent and
 * received per second (whole fleet), relay latency p50/p95/p99 (bots share a
 * clock, so send→receive is exact), MB/s received, worker event-loop lag (if
 * high, the harness is the bottleneck, add workers), auth failures, and
 * server CPU/RAM if --docker is set.
 */
import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { cpus } from "node:os";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");

// ── args ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {
    url: "http://localhost:1234",
    stages: [10, 25, 50, 100],
    hold: 30,
    ramp: 10,
    hz: 10,
    auth: false,
    world: null,
    chat: 0,
    workers: Math.max(1, cpus().length - 1),
    docker: null,
    origin: "http://localhost:5173",
    json: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === "--url") a.url = v();
    else if (k === "--stages") a.stages = v().split(",").map(Number);
    else if (k === "--hold") a.hold = Number(v());
    else if (k === "--ramp") a.ramp = Number(v());
    else if (k === "--hz") a.hz = Number(v());
    else if (k === "--auth") a.auth = true;
    else if (k === "--world") a.world = v();
    else if (k === "--chat") a.chat = Number(v());
    else if (k === "--workers") a.workers = Number(v());
    else if (k === "--docker") a.docker = v();
    else if (k === "--origin") a.origin = v();
    else if (k === "--json") a.json = v();
    else if (k === "--help" || k === "-h") {
      console.log(
        "See the header of scripts/loadtest/bots.mjs for options.\n" +
          "Example: node scripts/loadtest/bots.mjs --stages 10,25,50 --hold 20 --docker server-sync-service-1"
      );
      process.exit(0);
    } else throw new Error(`unknown option ${k}`);
  }
  if (/aweborn\.org/.test(a.url) && !process.env.LOADTEST_I_KNOW) {
    throw new Error("Refusing to load-test an aweborn.org host. Use a throwaway copy (set LOADTEST_I_KNOW=1 to override).");
  }
  return a;
}

// ── protocol (mirrors src/hooks/useCRDT.ts + server/sync-service/src/rooms.ts) ──
const T = { universeSync: 0x01, worldSync: 0x03, worldUpdate: 0x04, joinWorld: 0x07, presence: 0x09, chat: 0x0a, presenceBatch: 0x0b };
function encode(type, data, worldId) {
  const w = worldId ? Buffer.from(worldId) : Buffer.alloc(0);
  const buf = Buffer.alloc(3 + w.length + data.length);
  buf[0] = type;
  buf.writeUInt16BE(w.length, 1);
  w.copy(buf, 3);
  Buffer.from(data).copy(buf, 3 + w.length);
  return buf;
}

// ── worker: runs a share of the bots ─────────────────────────────────
async function worker() {
  const require = createRequire(path.join(repo, "server/sync-service/package.json"));
  const WebSocket = require("ws");
  let cfg = null;
  const bots = [];
  let latencies = [];
  let recvPresence = 0;
  let recvBytes = 0;
  let sentPresence = 0;
  let authFail = 0;
  let connectFail = 0;
  const connectMs = [];
  let chatErrors = 0;
  let lagMax = 0;

  // event-loop lag probe
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    lagMax = Math.max(lagMax, now - last - 100);
    last = now;
  }, 100).unref();

  async function signIn() {
    const res = await fetch(`${cfg.url}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: cfg.origin },
      body: "{}",
    });
    if (!res.ok) throw new Error(`anon sign-in ${res.status}`);
    const cookies = res.headers.getSetCookie?.() ?? [];
    return cookies.map((c) => c.split(";")[0]).join("; ");
  }

  async function spawnBot(id) {
    const bot = { id, ws: null, timers: [] };
    bots.push(bot);
    let cookie = "";
    if (cfg.auth) {
      try {
        cookie = await signIn();
      } catch {
        authFail++;
      }
    }
    const wsUrl = cfg.url.replace(/^http/, "ws") + "/universe?sectors=0%2C0%2C0";
    const t0 = performance.now();
    const ws = new WebSocket(wsUrl, { headers: { origin: cfg.origin, ...(cookie ? { cookie } : {}) } });
    bot.ws = ws;
    ws.binaryType = "nodebuffer";
    ws.on("error", () => {});
    ws.on("close", () => bot.timers.forEach(clearInterval));
    ws.on("message", (buf) => {
      recvBytes += buf.length;
      const type = buf[0];
      if (type === T.universeSync && !bot.synced) {
        bot.synced = true;
        connectMs.push(performance.now() - t0);
        start(bot);
      } else if (type === T.presenceBatch) {
        const wl = buf.readUInt16BE(1);
        try {
          const arr = JSON.parse(buf.subarray(3 + wl).toString());
          const now = Date.now();
          recvPresence += arr.length;
          for (const p of arr) if (p.lt) latencies.push(now - p.lt);
        } catch {}
      } else if (type === T.presence) {
        recvPresence++;
        const wl = buf.readUInt16BE(1);
        // Cheap: only parse ~1 in 20 for latency (parsing every one would make
        // the harness, not the server, the bottleneck at 100+ bots).
        if ((recvPresence & 15) === 0) {
          try {
            const p = JSON.parse(buf.subarray(3 + wl).toString());
            if (p.lt) latencies.push(Date.now() - p.lt);
          } catch {}
        }
      } else if (type === T.chat) {
        chatErrors++;
      }
    });
    const opened = await new Promise((r) => {
      ws.once("open", () => r(true));
      ws.once("error", () => r(false));
      setTimeout(() => r(false), 15_000);
    });
    if (!opened) connectFail++;
  }

  function start(bot) {
    const color = `hsl(${(bot.id * 47) % 360}, 70%, 60%)`;
    const pid = `loadbot-${process.pid}-${bot.id}`;
    const r = 20 + (bot.id % 30); // orbit radius around Origin
    const phase = Math.random() * Math.PI * 2;
    const period = 1000 / cfg.hz;
    bot.timers.push(
      setInterval(() => {
        if (bot.ws.readyState !== 1) return;
        const t = Date.now() / 4000 + phase;
        const state = {
          id: pid,
          position: { x: Math.cos(t) * r, y: Math.sin(t * 0.7) * 5, z: Math.sin(t) * r },
          velocity: { x: -Math.sin(t) * r * 0.25, y: 0, z: Math.cos(t) * r * 0.25 },
          inWorld: cfg.world,
          color,
          lt: Date.now(),
        };
        bot.ws.send(encode(T.presence, Buffer.from(JSON.stringify(state))));
        sentPresence++;
      }, period)
    );
    if (cfg.world) bot.ws.send(encode(T.joinWorld, Buffer.alloc(0), cfg.world));
    if (cfg.chat > 0) {
      bot.timers.push(
        setInterval(() => {
          if (bot.ws.readyState !== 1) return;
          bot.ws.send(encode(T.chat, Buffer.from(JSON.stringify({ text: `hello from bot ${bot.id}` })), cfg.world ?? "space"));
        }, cfg.chat * 1000 + Math.random() * 1000)
      );
    }
  }

  process.on("message", async (msg) => {
    if (msg.cmd === "config") cfg = msg.cfg;
    else if (msg.cmd === "spawn") {
      for (const id of msg.ids) {
        void spawnBot(id);
        await new Promise((r) => setTimeout(r, msg.gapMs));
      }
    } else if (msg.cmd === "reset") {
      latencies = [];
      recvPresence = recvBytes = sentPresence = chatErrors = 0;
      lagMax = 0;
    } else if (msg.cmd === "report") {
      process.send({
        cmd: "report",
        open: bots.filter((b) => b.ws?.readyState === 1).length,
        synced: bots.filter((b) => b.synced).length,
        latencies,
        recvPresence,
        recvBytes,
        sentPresence,
        authFail,
        connectFail,
        connectMs: connectMs.splice(0),
        chatErrors,
        lagMax,
      });
    } else if (msg.cmd === "stop") {
      bots.forEach((b) => b.ws?.close());
      setTimeout(() => process.exit(0), 300);
    }
  });
  process.send({ cmd: "ready" });
}

// ── coordinator ──────────────────────────────────────────────────────
const pct = (arr, p) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dockerStats(name) {
  try {
    const out = execFileSync("docker", ["stats", "--no-stream", "--format", "{{.CPUPerc}}|{{.MemUsage}}", name], {
      encoding: "utf8",
      timeout: 10_000,
    });
    const [cpu, mem] = out.trim().split("|");
    return { cpu, mem };
  } catch {
    return null;
  }
}

async function coordinator() {
  const cfg = parseArgs(process.argv.slice(2));
  console.log(`[loadtest] ${cfg.url}  stages ${cfg.stages.join(" → ")}  hold ${cfg.hold}s  ${cfg.hz} Hz  workers ${cfg.workers}` +
    `${cfg.auth ? "  +auth" : ""}${cfg.world ? `  world ${cfg.world}` : ""}${cfg.chat ? `  chat/${cfg.chat}s` : ""}`);

  try {
    const s = await (await fetch(`${cfg.url}/stats`)).json();
    console.log(`[loadtest] server before: ${JSON.stringify(s)}`);
  } catch (e) {
    throw new Error(`cannot reach ${cfg.url}/stats: ${e.message}`);
  }

  const workers = [];
  for (let i = 0; i < cfg.workers; i++) {
    const w = fork(fileURLToPath(import.meta.url), ["--worker"], { stdio: "inherit" });
    await new Promise((r) => w.once("message", r));
    w.send({ cmd: "config", cfg });
    workers.push(w);
  }
  const ask = async () =>
    Promise.all(
      workers.map(
        (w) =>
          new Promise((r) => {
            const on = (m) => m.cmd === "report" && (w.off("message", on), r(m));
            w.on("message", on);
            w.send({ cmd: "report" });
          })
      )
    );

  const results = [];
  let spawned = 0;
  for (const target of cfg.stages) {
    const add = target - spawned;
    if (add > 0) {
      const ids = Array.from({ length: add }, (_, i) => spawned + i);
      workers.forEach((w, wi) => {
        const mine = ids.filter((id) => id % workers.length === wi);
        if (mine.length) w.send({ cmd: "spawn", ids: mine, gapMs: (cfg.ramp * 1000) / mine.length });
      });
      spawned = target;
      await sleep(cfg.ramp * 1000);
    }
    await sleep(2000); // settle
    workers.forEach((w) => w.send({ cmd: "reset" }));
    const t0 = Date.now();
    await sleep(cfg.hold * 1000);
    const secs = (Date.now() - t0) / 1000;
    const reps = await ask();
    const sum = (k) => reps.reduce((n, r) => n + r[k], 0);
    const lat = reps.flatMap((r) => r.latencies);
    const conn = reps.flatMap((r) => r.connectMs);
    const docker = cfg.docker ? dockerStats(cfg.docker) : null;
    let server = null;
    try {
      server = await (await fetch(`${cfg.url}/stats`)).json();
    } catch {}
    const row = {
      bots: target,
      open: sum("open"),
      synced: sum("synced"),
      authFail: sum("authFail"),
      connectFail: sum("connectFail"),
      connectP95ms: Math.round(pct(conn, 95)),
      sentPerSec: Math.round(sum("sentPresence") / secs),
      recvPerSec: Math.round(sum("recvPresence") / secs),
      expectedRecvPerSec: Math.round((sum("sentPresence") / secs) * Math.min(30, Math.max(0, sum("open") - 1))), // server caps to the nearest 30
      recvMBps: +(sum("recvBytes") / secs / 1e6).toFixed(2),
      p50ms: Math.round(pct(lat, 50)),
      p95ms: Math.round(pct(lat, 95)),
      p99ms: Math.round(pct(lat, 99)),
      harnessLagMaxMs: Math.round(Math.max(...reps.map((r) => r.lagMax))),
      chatMsgsIn: sum("chatErrors"),
      serverCpu: docker?.cpu ?? null,
      serverMem: docker?.mem ?? null,
      serverClients: server?.rooms?.universeClients ?? null,
    };
    results.push(row);
    const delivered = row.expectedRecvPerSec ? Math.round((row.recvPerSec / row.expectedRecvPerSec) * 100) : 100;
    console.log(
      `[stage ${String(target).padStart(3)}] open ${row.open}/${target}  auth✗ ${row.authFail}  conn✗ ${row.connectFail}  ` +
        `sent ${row.sentPerSec}/s  recv ${row.recvPerSec}/s (${delivered}% of fan-out)  ${row.recvMBps} MB/s  ` +
        `relay p50 ${row.p50ms} p95 ${row.p95ms} p99 ${row.p99ms} ms  harness lag ${row.harnessLagMaxMs} ms` +
        `${docker ? `  server CPU ${docker.cpu} RAM ${docker.mem}` : ""}`
    );
    if (row.harnessLagMaxMs > 200) console.log("   ⚠ harness event loop is lagging: latency numbers include harness delay; add --workers or another machine");
  }

  workers.forEach((w) => w.send({ cmd: "stop" }));
  console.table(results);
  const pass = results.find((r) => r.bots === 100);
  if (pass) {
    const cpu = parseFloat(pass.serverCpu ?? "NaN");
    console.log(
      `[rule] 100 bots: p95 ${pass.p95ms} ms (need < 100)` +
        (Number.isFinite(cpu) ? `, server CPU ${pass.serverCpu} (need < ~50% of the box)` : ", server CPU not sampled (use --docker or watch kubectl top)")
    );
  }
  if (cfg.json) writeFileSync(cfg.json, JSON.stringify({ cfg, results }, null, 2));
  await sleep(500);
  process.exit(0);
}

if (process.argv.includes("--worker")) void worker();
else coordinator().catch((e) => {
  console.error(`[loadtest] ${e.message}`);
  process.exit(1);
});
