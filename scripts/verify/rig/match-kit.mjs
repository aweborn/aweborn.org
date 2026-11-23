// Sandbox rig: what the live match walkthroughs share (check-match-e2e, check-match-more,
// check-templates-live, check-library-live): a checklist, waits on store state, and one
// handle per player's page with the things a script asks of it.
import { api, sleep, store, standAt, waitFor, RIG_DIR, SYNC } from "./browser.mjs";

export function checklist() {
  const fails = [];
  const ok = (cond, what, extra = "") => {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}${extra ? `  ${extra}` : ""}`);
    if (!cond) fails.push(what);
    return Boolean(cond);
  };
  /** Wait (on state, not on the clock) until `fn` is truthy; a check either way. Returns the value or null. */
  const until = async (what, fn, ms = 30000) => {
    const v = await waitFor(fn, ms);
    ok(v, what, v ? "" : `(not within ${ms / 1000} s)`);
    return v;
  };
  const done = (label) => {
    console.log(fails.length ? `\n${fails.length} FAILED:\n - ${fails.join("\n - ")}` : "\nall passed", label);
    return fails.length ? 1 : 0;
  };
  return { ok, until, done, fails };
}

/** A two-team race on a 20 m stage with the lobby 12 m in front of it. Short clocks for the rig. */
export const RACE = {
  template: "race",
  settings: { teams: 2, players: { min: 2, max: 4 }, rounds: 1, roundSeconds: 180, scoreToWin: 1, traits: { speedMul: 1.25, gravityMul: 1, fly: false }, edge: "soft", edgeSeconds: 8 },
  arena: { at: [0, 0, -6], size: [20, 10, 20] },
  zones: [
    { id: "spawn-1", kind: "spawn", team: 1, at: [-6, 0, 0], size: [4, 3, 4] },
    { id: "spawn-2", kind: "spawn", team: 2, at: [6, 0, 0], size: [4, 3, 4] },
    { id: "goal-1", kind: "goal", at: [0, 0, -13], size: [4, 3, 4] },
  ],
  lobby: { at: [0, 0, 12], size: [12, 6, 12], ring: { at: [0, 0, 11], radius: 2 }, arrival: [0, 0, 15] },
  npcRoster: [{ id: "bolt", name: "Bolt", behavior: "auto", levels: { min: 1, max: 5 } }, { id: "pip", name: "Pip", behavior: "auto", levels: { min: 1, max: 5 } }],
};
const base = (template, settings, zones, extra = {}) => ({ ...RACE, template, settings: { ...RACE.settings, ...settings }, zones: [...RACE.zones.filter((z) => z.kind === "spawn"), ...zones], ...extra });
const ONE_SPAWN = [{ id: "spawn-1", kind: "spawn", team: 1, at: [0, 0, 0], size: [6, 3, 4] }];
/** One game per template, on the same stage and lobby as RACE. `roundSeconds` is set by the script that runs them. */
export const GAMES = {
  "race": RACE,
  "collect": base("collect", { scoreToWin: 10 }, []),
  "capture-the-flag": base("capture-the-flag", { scoreToWin: 3 }, [
    { id: "goal-1", kind: "goal", team: 1, at: [-7, 0, -12], size: [3, 3, 3] },
    { id: "goal-2", kind: "goal", team: 2, at: [7, 0, -12], size: [3, 3, 3] },
  ]),
  "king-of-the-hill": base("king-of-the-hill", { scoreToWin: 120, roundSeconds: 300 }, [{ id: "hill", kind: "goal", at: [0, 0, -8], size: [5, 3, 5] }]),
  "survive": { ...base("survive", { teams: 1, scoreToWin: 1 }, [{ id: "pit", kind: "keep-out", at: [0, 0, -10], size: [6, 3, 4], ret: "countdown" }]), zones: [...ONE_SPAWN, { id: "pit", kind: "keep-out", at: [0, 0, -10], size: [6, 3, 4], ret: "countdown" }] },
  "build-together": { ...base("build-together", { teams: 1, scoreToWin: 3 }, []), zones: [...ONE_SPAWN, { id: "site", kind: "goal", at: [0, 0, -12], size: [4, 3, 4] }] },
};
export const RING = RACE.lobby.ring.at;
export const GOAL = RACE.zones[2].at;

/** One player's page, with the questions and actions the walkthroughs use. */
export function player(page, name, worldId) {
  const h = {
    page, name,
    match: (fn, ...args) => store(page, "lib/match", "useMatchStore", fn, ...args),
    play: (fn, ...args) => store(page, "lib/matchPlay", "usePlayStore", fn, ...args),
    view: (fn, ...args) => store(page, "lib/matchView", "useViewStore", fn, ...args),
    send: (intent, world = worldId) => page.evaluate(async (w, intent) => (await import("/src/lib/match.ts")).sendMatch(w, intent), world, intent),
    has: async (sel) => Boolean(await page.$(sel)),
    text: (sel) => page.$eval(sel, (e) => e.textContent).catch(() => null),
    count: async (sel) => (await page.$$(sel)).length,
    /** Click through the DOM (a tap in the middle of a canvas-covered page is unreliable in software Chrome). */
    click: async (sel, ms = 8000) => {
      const el = await waitFor(() => page.$(sel), ms);
      if (!el) return false;
      await el.evaluate((e) => e.click());
      await sleep(250);
      return true;
    },
    pos: () => page.evaluate(async () => {
      const { interiorController: c } = await import("/src/systems/InteriorController.ts");
      return { x: c.state.x, y: c.state.y, z: c.state.z, mods: c.mods, hold: c.hold };
    }),
    stand: (x, y, z) => standAt(page, x, y, z),
    /** The ids of the other players this page draws as live-world bodies (presence). */
    others: () => page.evaluate(async () => [...(await import("/src/hooks/usePresence.ts")).getPresenceState().values()].filter((p) => p.inWorld).map((p) => p.id)),
    shot: (file) => page.screenshot({ path: `${RIG_DIR}/${file}.png` }),
    api: (path, body) => api(page, path, body),
    errors: () => page.errors.filter((e) => !/ERR_|Failed to load resource|fonts|stripe|google|WebSocket|404/i.test(e)),
    /** Step into the ring and wait until the server has this player in the pool. */
    queue: async (ring = RING) => {
      await standAt(page, ring[0], ring[1], ring[2] + 0.5);
      return waitFor(() => h.match((s) => s.lobby?.queued === true || s.found !== null || s.playing !== null), 20000);
    },
    /** Walk out of the ring (to the arrival point's side of the lobby). */
    stepOut: (ring = RING) => standAt(page, ring[0] + 4, ring[1], ring[2] + 3),
    /** The lobby is there and says it is ready. Says hello again if the first one was lost. */
    lobby: async (ms = 40000) => {
      const t0 = Date.now();
      let n = 0;
      while (Date.now() - t0 < ms) {
        if (await h.match((s) => s.lobby?.ready === true).catch(() => false)) return true;
        if (++n % 20 === 0) await h.send({ t: "hello" }).catch(() => null);
        await sleep(300);
      }
      return false;
    },
  };
  return h;
}

/** The stored record of a match (running or finished). */
export const recordOf = async (h, id) => (await h.api(`/api/match/record?id=${encodeURIComponent(id)}`)).data?.record ?? null;

/** Does replaying the record give its events and result (the hard rule)? Fetched through the route, replayed by the real referee in the page. */
export const verifies = (h, id) => h.page.evaluate(async (url) => {
  const { verifyRecord } = await import("/shared/match-referee.ts");
  const { record } = await (await fetch(url, { credentials: "include" })).json();
  return record?.result ? verifyRecord(record) : false;
}, `${SYNC}/api/match/record?id=${encodeURIComponent(id)}`);
