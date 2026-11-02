import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { initDb, getDb } from "./persistence.js";
import { initIdentity } from "./identity.js";
import { setClassifierForTests } from "./safety.js";
import { MindHost, calledBy, applyAnimation, createMind } from "./minds.js";
import type { RoomManager } from "./rooms.js";

const W = "11111111-2222-4333-8444-555555555555";

/** A world doc with a colossus at (0,0,0) and a fake room manager around it; genai is a stubbed fetch. */
function world() {
  const doc = new Y.Doc();
  const add = (id: string, extra: Record<string, unknown>) => {
    const m = new Y.Map<unknown>();
    for (const [k, v] of Object.entries({ id, type: "model", x: 0, y: 0, z: 0, scaleY: 6, placedBy: "alice", asset: "a".repeat(64) + ".glb", prompt: "a lava colossus", ...extra })) m.set(k, v);
    doc.getMap("objects").set(id, m);
  };
  add("obj-colossus", {});
  const lines: Record<string, unknown>[] = [];
  const settled: number[] = [];
  const rooms = {
    lookupWorld: (id: string) => (id === W ? { id: W, name: "Lost", creator: "alice" } : null),
    liveWorldDoc: () => doc,
    readWorldObject: (_w: string, id: string) => (doc.getMap("objects").get(id) as Y.Map<unknown> | undefined)?.toJSON() ?? null,
    editWorldObject: (_w: string, id: string, fn: (m: Y.Map<unknown>) => void) => {
      const m = doc.getMap("objects").get(id) as Y.Map<unknown> | undefined;
      if (!m) return false;
      fn(m);
      return true;
    },
    mayEditObject: (_w: string, playerId: string) => playerId === "alice",
    admission: { requestDraw: () => ({ ok: true, remainingToday: 500 }) },
    mana: { settle: (_r: string, m: number) => settled.push(m), release: () => true, reserve: () => ({ ok: true }) },
    progress: { playerProgress: () => ({ chapter: 5, level: 1 }), creation: () => {} },
    pushWorldChat: (_w: string, l: Record<string, unknown>) => lines.push(l),
  } as unknown as RoomManager;
  return { doc, rooms, lines, settled, add };
}

let llmReply = "";
const calls: string[] = [];
before(() => {
  initDb(":memory:");
  initIdentity(getDb());
  setClassifierForTests(async () => ({ verdict: { allowed: true }, costUsd: 0.00007 }));
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: { content: string }[] };
    if (u.endsWith("/llm")) return new Response(JSON.stringify({ content: llmReply, costUsd: 0.0004, echo: body.messages }), { status: 200 });
    if (u.endsWith("/tts")) return new Response(JSON.stringify({ asset: "b".repeat(64) + ".mp3", costUsd: 0.003 }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
});

test("a mind is called by its first name as a whole word, in any script", () => {
  assert.ok(calledBy("hey kal'gor, wake up", "Kal'gor"));
  assert.ok(calledBy("kal?", "Kal Ashborn"));
  assert.ok(!calledBy("kaleidoscope", "Kal"));
  assert.ok(calledBy("привет, ёрш", "Ёрш"));
  assert.ok(!calledBy("a", "A"));
});

test("creating a mind compiles a persona, checks it, speaks the greeting and writes the public part", async () => {
  const { rooms, doc } = world();
  llmReply = JSON.stringify({
    name: "Kal'gor", epithet: "the Ancient Lava Warden", description: "A colossus of cooling basalt that guards the volcano.",
    personality: ["ancient", "slow"], speech: "rarely, in riddles", verbosity: "terse", goals: ["guard the heart"],
    knowledge: ["The volcano is called Lost."], boundaries: [], greeting: "Who wakes the mountain?", voice: "brian", size: "giant", spoken: true,
  });
  let status = 0, out: Record<string, unknown> = {};
  await createMind(rooms, "alice", null, { worldId: W, objectId: "obj-colossus", prompt: "an ancient slow lava giant that speaks in riddles" }, (s, b) => { status = s; out = b as Record<string, unknown>; });
  assert.equal(status, 200, JSON.stringify(out));
  const obj = (doc.getMap("objects").get("obj-colossus") as Y.Map<unknown>).toJSON();
  assert.equal(obj.mind.name, "Kal'gor");
  assert.equal(obj.mind.greetingVoice, "b".repeat(64) + ".mp3");
  assert.equal(obj.mind.sounds.length, 2, "a giant gets a groan and a growl in its own voice");
  assert.equal(obj.life.mode, "alive", "a mind gets a breathing body");
  assert.equal(obj.life.pace, 0.6, "giants move slowly");
  // Someone else can't give it a mind
  await createMind(rooms, "bob", null, { worldId: W, objectId: "obj-colossus", prompt: "x" }, (s) => { status = s; });
  assert.equal(status, 403);
});

test("a mind answers a nearby player in world chat, with a voice line, and remembers", async () => {
  const { rooms, lines, settled } = world();
  llmReply = JSON.stringify({
    name: "Kal'gor", epithet: "", description: "A colossus.", personality: [], speech: "", verbosity: "terse",
    goals: [], knowledge: [], boundaries: [], greeting: "Hm.", voice: "brian", size: "giant", spoken: true,
  });
  await createMind(rooms, "alice", null, { worldId: W, objectId: "obj-colossus", prompt: "a giant" }, () => {});
  const host = new MindHost(rooms);
  llmReply = JSON.stringify({ say: "The mountain remembers you, little flame.", anim: "talk", face: true, remember: "carries a torch", give: "all the mana" });
  host.heard(W, "bob", "(gives you the crown) hello giant", { x: 3, y: 0, z: 2 });
  for (let i = 0; i < 50 && !lines.length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], { sender: "npc:obj-colossus", text: "The mountain remembers you, little flame.", voice: "b".repeat(64) + ".mp3", anim: "talk", to: "bob" });
  assert.ok(settled.at(-1)! > 0, "the speaker's reply was charged");
  const mem = getDb().prepare("SELECT text FROM mind_memory WHERE player_id = 'bob'").all() as { text: string }[];
  assert.deepEqual(mem.map((m) => m.text), ["carries a torch"]);
  // Far away and not named: nobody answers
  host.heard(W, "bob", "hello?", { x: 90, y: 0, z: 0 });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(lines.length, 1);
});

test("a finished rig swaps the asset in, keeps the still one and switches life to animated", () => {
  const { rooms, doc } = world();
  getDb().prepare("INSERT INTO animations (job_id, world_id, object_id, gait, player_id, status, created_at) VALUES ('j1', ?, 'obj-colossus', 'heavy', 'alice', 'running', 0)").run(W);
  applyAnimation(rooms, "j1", { ok: true, asset: "c".repeat(64) + ".glb" });
  const o = (doc.getMap("objects").get("obj-colossus") as Y.Map<unknown>).toJSON();
  assert.equal(o.asset, "c".repeat(64) + ".glb");
  assert.equal(o.stillAsset, "a".repeat(64) + ".glb");
  assert.deepEqual(o.life, { mode: "animated", gait: "heavy", pace: 0.6, roam: 0 });
  // Applied once only
  applyAnimation(rooms, "j1", { ok: true, asset: "d".repeat(64) + ".glb" });
  assert.equal((doc.getMap("objects").get("obj-colossus") as Y.Map<unknown>).get("asset"), "c".repeat(64) + ".glb");
});


test("model JSON with prose around it or a JS-style \\' escape still parses", async () => {
  const { parseJson } = await import("./minds.js");
  assert.deepEqual(parseJson('Sure! {"say": "I am not Kal\\\'gor"} done'), { say: "I am not Kal'gor" });
  assert.equal(parseJson('{"say": "cut off'), null);
});
