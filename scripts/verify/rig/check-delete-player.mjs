// Sandbox rig: "Delete my player…" against the real server and app (erase-player.ts,
// DeletePlayer.tsx). A saved player with two characters plants a world, places things,
// chats, makes another player a builder, plays a match with them and turns the 18+
// switch on. Then they delete their player through the panel. Checked through the API,
// the other player's screen and the database: the promises on the Privacy page hold.
//
//   RIG_N=4 scripts/verify/rig/up.sh && RIG_N=4 node scripts/verify/rig/check-delete-player.mjs
// Screenshots: /tmp/rig<N>/delete-*.png  (the confirm step at phone and desktop size)
//
// The script opens the rig's database twice: once to make a sign-in look 10 minutes old
// (there is no other way to wait out the 5-minute "confirm it's you" window), and at the
// end, read-only, to look for anything of the deleted player.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { launch, open, sleep, session, savedPlayer, plantWorld, enterWorld, waitFor, api, RIG_DIR, WEB, SYNC, VIEWPORTS } from "./browser.mjs";
import { checklist, player, recordOf, RACE, GOAL } from "./match-kit.mjs";

const { ok, until, done } = checklist();
const DB = `${RIG_DIR}/universe.db`;
const EMAIL = `leaving-${Date.now()}@rig.test`;
const b = await launch();

const rect = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null; }, sel);
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const click = (page, sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
async function openPanel(page) {
  await waitFor(() => page.$(".pa-chip"));
  if (!(await page.evaluate(() => document.querySelector(".pa-dialog")?.open === true))) await click(page, ".pa-chip");
  await waitFor(() => page.evaluate(() => document.querySelector(".pa-dialog")?.open === true));
  await sleep(600);
}
/** Sign this page's guest in with an e-mail code (the rig's fixed code), as the app does. */
async function signIn(page, email) {
  await session(page);
  const r = await page.evaluate(async (email) => {
    const m = await import("/src/lib/player.ts");
    const sent = await m.sendEmailCode(email);
    return sent.ok ? m.verifyEmailCode(email, "123456") : sent;
  }, email);
  if (!r.ok) throw new Error(`sign-in failed: ${r.message}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  const id = await waitFor(() => page.evaluate(async () => {
    const p = (await import("/src/lib/player.ts")).getPlayerSnapshot();
    return p && !p.isGuest && !p.isAnonymous ? p.playerId : null;
  }), 40000);
  if (!id) throw new Error("not saved after signing in");
  await sleep(1500);
  return id;
}
const place = (page, at) => page.evaluate(async (at) => {
  const { useUniverseStore } = await import("/src/stores/universeStore.ts");
  const { placeBlock } = await import("/src/stores/worldStore.ts");
  const { getPlayerSnapshot } = await import("/src/lib/player.ts");
  return placeBlock(useUniverseStore.getState().activeWorldDoc, { id: "stone", name: "Stone", color: "#888888" }, at, getPlayerSnapshot().playerId);
}, at);
const say = (page, worldId, line) => page.evaluate(async (w, line) => (await import("/src/stores/chatStore.ts")).useChatStore.getState().send(w, line), worldId, line);
const worldNow = (page) => page.evaluate(async () => {
  const doc = (await import("/src/stores/universeStore.ts")).useUniverseStore.getState().activeWorldDoc;
  return doc ? { meta: doc.getMap("meta").toJSON(), objects: Object.values(doc.getMap("objects").toJSON()), chat: doc.getArray("chat").toArray() } : null;
});

// ── The people ──────────────────────────────────────────────────────
const ctxA = await b.createBrowserContext(), ctxA2 = await b.createBrowserContext(), ctxB = await b.createBrowserContext();
const [pa, pa2, pb] = await Promise.all([open(b, WEB, "phone", ctxA), open(b, WEB, "phone", ctxA2), open(b, WEB, "phone", ctxB)]);
const idB = await savedPlayer(pb);
const idA = await signIn(pa, EMAIL);
const idA2guest = await session(pa2); // a second device, still a guest: its character joins the account below
ok((await api(pa2, "/api/player/character/name", { name: "Quillon" })).status === 200, "the second character has a name");
ok((await api(pa, "/api/player/character/name", { name: "Zephyrine" })).status === 200, "the first character has a name");
ok((await api(pb, "/api/player/character/name", { name: "Bartholomew" })).status === 200, "the other player has a name");

// A guest is told there is nothing saved to delete
{
  const r = await api(pa2, "/api/player/delete", { confirm: "DELETE" });
  ok(r.status === 403 && r.data.error === "not_saved" && /isn’t saved/.test(r.data.message), "a guest is refused: no saved player to delete", r.data?.message);
  await openPanel(pa2);
  ok(!(await pa2.$("#player-delete-open")), "a guest's panel has no Delete my player");
  await pa2.evaluate(() => document.querySelector(".pa-dialog")?.close());
}

const W = await plantWorld(pa, "Erase Arena");
ok((await api(pa, "/api/player/world/game", { worldId: W, game: RACE })).status === 200, "they made the world a game");
ok((await api(pa, "/api/player/door", { show: true })).data?.show === true, "they turned the 18+ switch on");
await Promise.all([enterWorld(pa, W), enterWorld(pa2, W), enterWorld(pb, W)]);
const A = player(pa, "A", W), B = player(pb, "B", W);

// Things placed (away from the stage) and chat, by both characters and by the other player
const oA = await place(pa, { x: 40, y: 2, z: 40 });
const oA2 = await place(pa2, { x: 44, y: 2, z: 40 });
const oB = await place(pb, { x: 48, y: 2, z: 40 });
ok(oA && oA2 && oB, "three things placed: one by each character, one by the other player");
await say(pa, W, "Zephyrine was here");
await sleep(1200);
await say(pa2, W, "so was Quillon");
await sleep(1200);
await say(pb, W, "and Bartholomew stays");
await say(pa, "space", "calling from space");
await until("everyone's lines are in the world's chat", async () => (await worldNow(pb))?.chat.length >= 3, 15000);

// The second device signs in: its character joins the account (two characters, one person)
const idA2 = await signIn(pa2, EMAIL);
ok(idA2 === idA2guest, "the second device keeps playing its own character after signing in");
const meA = (await api(pa, "/api/player/me")).data;
ok(meA.characters.length === 2 && meA.characters.some((c) => c.id === idA2), "the account has two characters", meA.characters.map((c) => c.name).join(", "));
const accountEmail = meA.methods.email;
ok(accountEmail === EMAIL, "saved with the e-mail");
ok((await api(pa, "/api/player/world/builders", { worldId: W, add: idB })).status === 200, "they made the other player a builder");
await enterWorld(pa2, W);

// A match between the two (the second device stays in the lobby)
for (const h of [A, B]) ok(await h.lobby(), `${h.name}: the lobby is ready`);
await A.queue(); await B.queue();
const M = await until("the two are matched and playing", async () => {
  const [a, c] = await Promise.all([A.match((s) => s.playing?.matchId), B.match((s) => s.playing?.matchId)]);
  return a && a === c ? a : null;
}, 60000);
await until("the round is on", () => B.match((s) => s.snap?.phase === "playing"), 30000);
await B.walk(GOAL[0], GOAL[1], GOAL[2]); // walked: the server refuses a jump inside a match
await until("the match ends with a result", async () => (await A.match((s) => Boolean(s.ended))) && (await B.match((s) => Boolean(s.ended))), 40000);
const aweBefore = (await api(pa, "/api/player/progress")).data.progress.xp;
const before = await recordOf(B, M);
ok(before?.setup.slots.some((s) => s.id === idA && s.name === "Zephyrine"), "before: the replay names them");
ok((await api(pa, "/api/player/replays")).data.matches.some((m) => m.id === M), "before: the replay is in their character's list");
await click(pa, "#match-leave"); await click(pa, "#match-results-close");

// Planner history: the rig has no genai-service to plan with, so two conversations are written straight into
// the tables the planner uses (theirs first, then the other player's), as the planner would have
const stone = async () => (await (await fetch(`${SYNC}/making-of?worldId=${W}&t=${Date.now()}`)).json()).sessions.map((x) => ({ by: x.by, lines: x.entries.map((e) => e.text) }));
await api(pa, `/api/player/plan?worldId=${W}`); // makes the tables
{
  const db = new DatabaseSync(DB);
  const add = (id, who, at, said) => {
    db.prepare("INSERT INTO plan_sessions (id, player_id, world_id, version, blueprint, created_at, updated_at, research_id) VALUES (?, ?, ?, 1, NULL, ?, ?, NULL)").run(id, who, W, at, at);
    db.prepare("INSERT INTO plan_events (session_id, kind, payload, at) VALUES (?, 'user', ?, ?)").run(id, JSON.stringify({ message: said }), at + 1);
    db.prepare("INSERT INTO plan_events (session_id, kind, model, version, payload, at) VALUES (?, 'turn', 'rig/model', 1, ?, ?)").run(id, JSON.stringify({ reply: `Planned: ${said}`, chips: [] }), at + 2);
  };
  add("rig-plan-a", idA, 1000, "a tall lighthouse on the cliff");
  add("rig-plan-b", idB, 2000, "a harbour below it");
  add("rig-plan-a2", idA, 3000, "and a rowing boat");
  db.close();
}
await sleep(9000); // the story stone's answer is reused for 8 s
const stoneBefore = await stone();
ok(JSON.stringify(stoneBefore.map((x) => x.by)) === JSON.stringify(["Maker 1", "Maker 2", "Maker 1"]), "before: the story stone has their two conversations as Maker 1 and the other player's as Maker 2", JSON.stringify(stoneBefore.map((x) => x.by)));
await sleep(1500);
// Back in the pool when they delete: the match host must let go of them
await A.match(() => null).catch(() => null);
await A.queue().catch(() => null);

// ── The are-you-sure step (phone) ───────────────────────────────────
await openPanel(pa);
ok(await pa.$("#player-signout") && await pa.$("#player-door-switch"), "the saved player's panel: sign out and the 18+ switch");
await until("Delete my player… is in the panel", () => pa.$("#player-delete-open"), 10000);
const order = await pa.evaluate(() => {
  const all = [...document.querySelectorAll("#player-account-dialog .pa-panel button, #player-account-dialog .pa-panel a")];
  return { last: all[all.length - 1]?.id, afterSignOut: all.findIndex((e) => e.id === "player-delete-open") > all.findIndex((e) => e.id === "player-signout") };
});
ok(order.last === "player-delete-open" && order.afterSignOut, "it is the last thing in the panel, after signing out", JSON.stringify(order));
await pa.evaluate(() => document.querySelector("#player-delete-open").scrollIntoView({ block: "center" }));
const entry = await rect(pa, "#player-delete-open");
ok(entry && entry.h >= 44 && entry.w >= 44, "a 44 px target", JSON.stringify(entry));
ok(await pa.evaluate(() => { const e = document.querySelector(".dp-entry"); return parseFloat(getComputedStyle(e).borderTopWidth) > 0 && parseFloat(getComputedStyle(e).paddingTop) >= 8; }), "set apart from the rest by a rule and space");
await sleep(300);
await pa.screenshot({ path: `${RIG_DIR}/delete-phone-0-entry.png` });

// The sign-in is made to look 10 minutes old: the step asks to confirm first, and nothing can be deleted yet
{
  const db = new DatabaseSync(DB);
  db.prepare(`UPDATE session SET createdAt = ? WHERE userId = (SELECT id FROM "user" WHERE email = ?)`).run(new Date(Date.now() - 10 * 60_000).toISOString(), EMAIL);
  db.close();
}
ok((await api(pa, "/api/player/delete", { confirm: "delete" })).status === 400, "the server refuses the wrong word (lower case)");
const stale = await api(pa, "/api/player/delete", { confirm: "DELETE" });
ok(stale.status === 403 && stale.data.code === "SESSION_NOT_FRESH", "the server refuses the right word from a sign-in older than 5 minutes");
ok((await api(pa, "/api/player/me")).data.characters.length === 2, "nothing was deleted by the refused tries");

await click(pa, "#player-delete-open");
await until("the are-you-sure step opens", () => pa.$("#player-delete"), 8000);
await until("it asks to confirm it's you first", () => pa.$("#player-delete-confirm-first"), 8000);
ok(!(await pa.$("#player-delete-submit")), "no delete button until then");
await pa.evaluate(() => document.querySelector("#player-delete-confirm-first").scrollIntoView({ block: "center" }));
await sleep(300);
await pa.screenshot({ path: `${RIG_DIR}/delete-phone-1-confirm-first.png` });
await click(pa, "#player-delete-confirm-first");
await until("the panel's own Confirm it's you step", () => pa.$("#pa-confirm-title"), 8000);
ok(/Before deleting your player/.test(await text(pa, ".pa-confirm .pa-hint") ?? ""), "it says what the confirmation is for, and that nothing is deleted yet");
await click(pa, "#player-email-confirm");
await until("a code is asked for", () => pa.$(".pa-confirm .pa-input--code"), 15000);
await pa.type(".pa-confirm .pa-input--code", "123456");
await pa.keyboard.press("Enter");
await until("confirmed: back at the are-you-sure step, with the word to type", () => pa.$("#player-delete-submit"), 30000);

// What it says, before anything happens
const said = (await text(pa, "#player-delete")) ?? "";
ok(/Delete your player\?/.test(said), "it asks: Delete your player?");
ok(/destroys everything about your player/.test(said) && /cannot be undone/.test(said), "it says it destroys everything and cannot be undone");
const gone = (await text(pa, "#player-delete-gone")) ?? "";
for (const [what, re] of [["your sign-in", /Your sign-in/], ["all your characters", /Both your characters/], ["progress and awe", /progress and awe/], ["World Index", /World Index/]]) {
  ok(re.test(gone), `destroyed: ${what}`);
}
const stays = (await text(pa, "#player-delete-stays")) ?? "";
ok(!/chat|planner/i.test(gone), "chat and planner history are not listed as destroyed");
ok(/What you wrote in world chat and to the planner stays, without your name\./.test(stays) && /If your words themselves say who you are, they still will/.test(stays), "stays: what they wrote in chat and to the planner, without their name; and it says the words can still identify them");
ok(/Worlds you made and things you placed stay for the people who built there, with your name removed/.test(stays) && /The world you made will have no creator/.test(stays), "stays: worlds and placed things, without their name (and their one world is counted)");
ok(/Replays of matches you played stay for the other players, with an anonymous “Player”/.test(stays), "stays: replays, with an anonymous stand-in");
ok(/donations and card orders stay in our accounts and in the public ledger/.test(stays) && /no link to your player/.test(stays), "stays: money records, without the player");
ok(!/sorry to see you go|are you really|we.ll miss|please stay|lose out/i.test(said), "no pleading");

// The destructive button is off until the word is typed; sizes
const state = () => pa.evaluate(() => ({ disabled: document.querySelector("#player-delete-submit")?.disabled, font: parseFloat(getComputedStyle(document.querySelector("[data-testid=player-delete-word]")).fontSize) }));
ok((await state()).disabled === true, "the delete button is off until the word is typed");
ok((await state()).font >= 16, "the input is 16 px (no zoom on iOS)", String((await state()).font));
for (const sel of ["#player-delete-submit", "#player-delete-cancel", "[data-testid=player-delete-word]"]) {
  const r = await rect(pa, sel);
  ok(r && r.h >= 44, `${sel} is at least 44 px tall`, JSON.stringify(r));
}
const fits = (page, vw) => page.evaluate((vw) => [...document.querySelectorAll("#player-delete *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5); }).length === 0 && document.documentElement.scrollWidth <= innerWidth, vw);
ok(await fits(pa, 390), "nothing runs off the side at 390 px");
await pa.evaluate(() => { document.querySelector(".pa-panel").scrollTop = 0; });
await sleep(300);
await pa.screenshot({ path: `${RIG_DIR}/delete-phone-2-sure-top.png` });
await pa.type("[data-testid=player-delete-word]", "delet");
ok((await state()).disabled === true, "still off with the word half typed");
await pa.type("[data-testid=player-delete-word]", "e");
ok((await state()).disabled === false, "on once the word is there (any case)");
await pa.evaluate(() => document.querySelector("#player-delete-submit").scrollIntoView({ block: "end" }));
await sleep(300);
await pa.screenshot({ path: `${RIG_DIR}/delete-phone-3-sure-bottom.png` });

// Keep my player goes back with nothing changed; then again, and through
await click(pa, "#player-delete-cancel");
await until("Keep my player: back at the panel", async () => !(await pa.$("#player-delete")) && (await pa.$("#player-signout")), 8000);
ok((await api(pa, "/api/player/me")).data.characters.length === 2, "nothing changed");
await click(pa, "#player-delete-open");
await until("the step again", () => pa.$("#player-delete-submit"), 8000);
ok((await state()).disabled === true, "the word has to be typed again");
await pa.type("[data-testid=player-delete-word]", "DELETE");
await click(pa, "#player-delete-submit");
// The page starts over as a fresh guest at once, and says so
const guest = await until("the page starts over as a new guest", () => pa.evaluate(async (old) => {
  const p = (await import("/src/lib/player.ts")).getPlayerSnapshot();
  return p && !p.isGuest && p.isAnonymous && !old.includes(p.playerId) ? p.playerId : null;
}, [idA, idA2]).catch(() => null), 90000);
await until("Your player is deleted", () => pa.$("#player-deleted").catch(() => null), 60000);
ok(/Your player is deleted/.test(await text(pa, "#player-deleted") ?? ""), "the short screen says so");
ok(!(await pa.$("#player-signout")) && !(await pa.$("#player-delete-open")), "nothing of the old panel is behind it");
await sleep(900); // the dialog scales in: measure once it is still
const cont = await rect(pa, "#player-deleted-continue");
ok(cont && cont.h >= 44, "Continue as a guest is a 44 px target", JSON.stringify(cont));
await pa.screenshot({ path: `${RIG_DIR}/delete-phone-4-deleted.png` });
await click(pa, "#player-deleted-continue");
await until("Continue as a guest closes it", () => pa.evaluate(() => document.querySelector(".pa-dialog")?.open === false), 8000);

// ── What the promises say, through the API ──────────────────────────
await until("the other player no longer sees either character in the world", async () => { const o = await B.others(); return !o.includes(idA2) && !o.includes(idA); }, 30000);
// The other device was signed in to the same player: its connection is closed and it starts over as a guest
const other = await until("signed out everywhere: the other device starts over as a new guest", () => pa2.evaluate(async (old) => {
  const p = (await import("/src/lib/player.ts")).getPlayerSnapshot();
  return p && !p.isGuest && p.isAnonymous && !old.includes(p.playerId) ? p.playerId : null;
}, [idA, idA2]).catch(() => null), 60000);
const me2 = await waitFor(async () => { const r = await api(pa2, "/api/player/me"); return r.status === 200 ? r.data : null; }, 20000);
ok(other && me2?.characters.length === 1 && me2.methods.email === null, "with nothing of the deleted player", JSON.stringify(me2 && { characters: me2.characters.length, email: me2.methods.email }));
ok(await until("and is told why", () => pa2.$("#player-deleted").catch(() => null), 30000), "the other device also shows Your player is deleted");
const names = await (await fetch(`${SYNC}/players/names?ids=${idA},${idA2},${idB}`)).json();
ok(names.names[idA] === undefined && names.names[idA2] === undefined && names.names[idB] === "Bartholomew", "their names are gone; the other player's is not");

const pub = await (await fetch(`${SYNC}/worlds/${W}`)).json();
ok(pub.creator === "former" && pub.name === "Erase Arena", "the world stays, with no creator (a former player)", JSON.stringify({ creator: pub.creator, name: pub.name }));
const w = await until("the other player's copy of the world follows", async () => { const v = await worldNow(pb); return v && v.meta.creator === "former" ? v : null; }, 20000);
ok(JSON.stringify(w?.meta.coCreators) === JSON.stringify([idB]), "its builders are intact (the other player)");
const byId = Object.fromEntries((w?.objects ?? []).map((o) => [o.id, o.placedBy]));
ok(byId[oA] === "former" && byId[oA2] === "former" && byId[oB] === idB, "what they placed is still there, placed by nobody; the other player's is theirs", JSON.stringify(byId));
ok(!JSON.stringify(w).includes(idA) && !JSON.stringify(w).includes(idA2), "the world document holds neither character's id");
const theirs = w?.chat.filter((l) => /Zephyrine was here|so was Quillon/.test(l.text)) ?? [];
ok(theirs.length === 2 && theirs.every((l) => l.sender === "former") && w.chat.some((l) => l.sender === idB && /Bartholomew stays/.test(l.text)), "their chat lines are still in the visible log, as written, from a former player; the other player's are theirs", JSON.stringify(w?.chat.map((l) => `${l.sender.slice(0, 8)}: ${l.text}`)));
await B.click("#chat-open");
const shown = await until("the other player's chat shows the lines as from A former player", () => pb.evaluate(() => [...document.querySelectorAll(".chat-line")].filter((p) => /Zephyrine was here|so was Quillon/.test(p.textContent)).map((p) => ({ name: p.querySelector(".chat-name")?.textContent, tappable: Boolean(p.querySelector(".chat-name--btn")) }))).then((v) => (v.length === 2 ? v : null)), 15000);
ok(shown?.every((x) => x.name === "A former player" && !x.tappable), "named “A former player”, with nothing to tap (nobody to mute or report)", JSON.stringify(shown));
const stoneAfter = await stone();
ok(JSON.stringify(stoneAfter) === JSON.stringify(stoneBefore), "the story stone is unchanged: every conversation still there, as written, the same Maker numbers", JSON.stringify(stoneAfter.map((x) => x.by)));
ok((await api(pb, "/api/player/world/game", { worldId: W, game: RACE })).status === 200, "the builder can still change the world's game");

const after = await recordOf(B, M);
const seat = after?.setup.slots.find((s) => s.kind === "human" && s.id !== idB);
ok(seat?.name === "Player" && /^stand-in:\d+$/.test(seat.id), "the replay stays, with an anonymous stand-in where they were", JSON.stringify(seat));
ok(after.frames.length === before.frames.length && JSON.stringify(after.result) === JSON.stringify(before.result), "the same match: every recorded tick and the result");
ok(!JSON.stringify(after).includes(idA) && !JSON.stringify(after).includes("Zephyrine"), "the record names them nowhere");
const mine = (await api(pb, "/api/player/replays")).data.matches.find((m) => m.id === M);
ok(mine && mine.roster.some((r) => r.name === "Player") && mine.roster.some((r) => r.name === "Bartholomew" && r.you), "the other player still has the replay in their list, with “Player” in it", JSON.stringify(mine?.roster));
ok((await api(pb, `/api/match/world?worldId=${W}`)).data.matches.some((m) => m.id === M && m.roster.some((r) => r.name === "Player")), "and the world's lobby still lists it");
const meB = (await api(pb, "/api/player/me")).data;
ok(meB.worldIndex.some((e) => e.worldId === W && e.world?.creator === "former"), "the other player's World Index still has the world");
await pb.screenshot({ path: `${RIG_DIR}/delete-phone-5-other-player.png` });

// ── A fresh guest, and the same e-mail again ────────────────────────
const gme = await waitFor(async () => { const r = await api(pa, "/api/player/me"); return r.status === 200 ? r.data : null; }, 20000);
const g = gme ?? { methods: {}, characters: [] };
ok(guest !== idA && guest !== idA2 && g.methods.email === null && g.characters.length === 1, "after the screen they are a fresh guest", JSON.stringify({ characters: g.characters.length, email: g.methods.email }));
ok(await pa.evaluate(() => localStorage.length === 0 || ![...Array(localStorage.length).keys()].some((i) => (localStorage.getItem(localStorage.key(i)) ?? "").includes("rig.test"))), "this device no longer remembers their e-mail");
const again = await signIn(pa, EMAIL);
const n = (await api(pa, "/api/player/me")).data;
ok(again !== idA && again !== idA2, "the same e-mail signs up again as a new player");
ok(again === guest, "it is the guest they had become, now saved (saving works as for anyone)", `${again} / ${guest}`);
ok(n.characters.length === 1 && n.characters[0].name === null && n.door.show === false, "nothing carried over: one unnamed character, the 18+ switch off", JSON.stringify({ characters: n.characters.length, door: n.door }));
ok(!n.worldIndex.some((e) => e.state === "visited"), "no visited worlds in their World Index");
ok((await api(pa, "/api/player/replays")).data.matches.length === 0, "no replays");
const aweNow = (await api(pa, "/api/player/progress")).data.progress.xp;
ok(aweNow < aweBefore && aweNow <= 60, "none of the old awe (only what the new guest earned by arriving)", `${aweBefore} before, ${aweNow} now`);
ok((await api(pa, "/api/player/world/game", { worldId: W, game: RACE })).status === 403, "and no rights over the world they once made");

// ── The database ────────────────────────────────────────────────────
await sleep(1500);
{
  const db = new DatabaseSync(DB, { readOnly: true });
  const needles = [idA, idA2, EMAIL, "Zephyrine", "Quillon"];
  const names = ["Zephyrine", "Quillon"];
  const hits = {}, inText = {};
  let pending = 0;
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
    for (const row of db.prepare(`SELECT * FROM "${t.name}"`).all()) {
      const flat = Object.values(row).map((v) => (v instanceof Uint8Array ? Buffer.from(v).toString("latin1") : String(v))).join("\u0000");
      // The new player made with the same e-mail is somebody else: their rows hold the address again
      const found = needles.filter((s) => flat.includes(s) && !(s === EMAIL && (t.name === "user" || t.name === "verification")));
      if (found.length === 0) continue;
      if (t.name === "erase_pending") pending++;
      // What they wrote stays as written: this script's chat lines say the names in their own words
      else if (found.every((s) => names.includes(s)) && (t.name === "chat_messages" || t.name === "documents")) inText[t.name] = (inText[t.name] ?? 0) + 1;
      else hits[t.name] = (hits[t.name] ?? 0) + 1;
    }
  }
  ok(Object.keys(hits).length === 0, "no table or stored document holds their ids or e-mail, or their names as names", JSON.stringify(hits));
  ok(inText.chat_messages === 2 && inText.documents >= 1, "their names remain only inside the words of chat lines they wrote (kept as written)", JSON.stringify(inText));
  const chat = db.prepare("SELECT player_id, text FROM chat_messages WHERE text LIKE '%Zephyrine was here%' OR text LIKE '%so was Quillon%' OR text LIKE '%calling from space%'").all();
  ok(chat.length === 3 && chat.every((c) => c.player_id === "former"), "the research copy of their chat: all three messages kept, from “former”", JSON.stringify(chat.map((c) => c.player_id)));
  const plans = db.prepare("SELECT id, player_id FROM plan_sessions ORDER BY id").all();
  const pa1 = plans.find((r) => r.id === "rig-plan-a")?.player_id;
  ok(plans.length === 3 && /^former:[0-9a-f]{16}$/.test(pa1 ?? "") && plans.find((r) => r.id === "rig-plan-a2")?.player_id === pa1 && plans.find((r) => r.id === "rig-plan-b")?.player_id === idB, "planner history: all three sessions kept; theirs under one random stand-in for this world", JSON.stringify(plans.map((r) => r.player_id.slice(0, 12))));
  ok(db.prepare("SELECT COUNT(*) AS n FROM plan_events").get().n === 6, "and every planner entry");
  // The one stated exception in this rig: there is no genai-service here, so its step waits in the queue
  ok(pending === 1, "the genai-service step is queued until that service answers (the rig has none): its queue row is the only place their ids remain", `rows: ${pending}`);
  const users = db.prepare(`SELECT COUNT(*) AS n FROM "user" WHERE email = ?`).get(EMAIL).n;
  ok(users === 1, "one account has that e-mail: the new one");
  const audit = db.prepare("SELECT at, characters, counts FROM erase_audit ORDER BY id DESC LIMIT 1").get();
  const counts = JSON.parse(audit.counts);
  ok(audit.characters === 2 && counts.user === 1 && counts.character === 2 && counts.session >= 2 && counts["world.objects"] === 2 && counts["world.chat"] >= 2 && counts.chat_messages === 3 && counts.plan_sessions === 2 && counts.matches === 1 && counts.age_door === 1,
    "the audit line: when, how many characters, how many rows of what", JSON.stringify(counts));
  ok(!needles.some((s) => audit.counts.includes(s)), "and nothing about who");
  ok(db.prepare("SELECT COUNT(*) AS n FROM mana_ledger").get().n >= 0 && db.prepare("SELECT COUNT(*) AS n FROM mana_ledger WHERE player_id IN (?, ?)").get(idA, idA2).n === 0, "the ledger holds no entry linked to them");
  db.close();
}
const log = readFileSync(`${RIG_DIR}/sync.log`, "utf8");
const line = log.split("\n").find((l) => l.includes("[erase] a player was deleted"));
ok(line && !line.includes(idA) && !line.includes(EMAIL), "the server's log line for the delete has no id or e-mail", line?.slice(0, 120));
console.log(`note  the server log as a whole still mentions their player ids ${log.split(idA).length - 1 + log.split(idA2).length - 1} time(s) (sign-in and room lines written before the delete)`);

// ── The are-you-sure step at desktop size (not deleted: Keep my player) ──
{
  const ctx = await b.createBrowserContext();
  const page = await open(b, WEB, "desktop", ctx);
  await savedPlayer(page);
  await openPanel(page);
  await until("[desktop] Delete my player… is in the panel", () => page.$("#player-delete-open"), 10000);
  await page.evaluate(() => document.querySelector("#player-delete-open").scrollIntoView({ block: "center" }));
  await sleep(300);
  await page.screenshot({ path: `${RIG_DIR}/delete-desktop-0-entry.png` });
  await click(page, "#player-delete-open");
  await until("[desktop] the are-you-sure step, ready for the word (signed in a moment ago)", () => page.$("#player-delete-submit"), 10000);
  ok(/One|Your character/.test(await text(page, "#player-delete-gone") ?? ""), "[desktop] one character: it says Your character");
  ok(await fits(page, VIEWPORTS.desktop[0]), "[desktop] nothing runs off the side");
  for (const sel of ["#player-delete-submit", "#player-delete-cancel"]) {
    const r = await rect(page, sel);
    ok(r && r.h >= 44, `[desktop] ${sel} is at least 44 px tall`, JSON.stringify(r));
  }
  const whole = await page.evaluate(() => { const p = document.querySelector(".pa-panel"); return { scrolls: p.scrollHeight > p.clientHeight + 1, h: p.clientHeight }; });
  console.log(`note  [desktop] the panel is ${whole.h} px tall${whole.scrolls ? " and scrolls" : ""}`);
  await page.screenshot({ path: `${RIG_DIR}/delete-desktop-1-sure.png` });
  await page.evaluate(() => document.querySelector("#player-delete-submit").scrollIntoView({ block: "end" }));
  await sleep(300);
  await page.screenshot({ path: `${RIG_DIR}/delete-desktop-2-sure-bottom.png` });
  await click(page, "#player-delete-cancel");
  await until("[desktop] Keep my player: back at the panel", async () => !(await page.$("#player-delete")) && (await page.$("#player-signout")), 8000);
  ok((await api(page, "/api/player/me")).data.methods.email !== null, "[desktop] still the same saved player");
  const errs = page.errors.filter((e) => !/ERR_|Failed to load resource|fonts|stripe|google|WebSocket|404/i.test(e));
  ok(errs.length === 0, "[desktop] no page errors", errs.slice(0, 3).join(" | "));
}
const errs = [...pa.errors, ...pb.errors].filter((e) => !/ERR_|Failed to load resource|fonts|stripe|google|WebSocket|401|403|404|400/i.test(e));
ok(errs.length === 0, "no page errors on the phones", errs.slice(0, 3).join(" | "));

await b.close();
process.exit(done("(check-delete-player)"));
