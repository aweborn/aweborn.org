import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { touchesChat } from "./chat-guard.js";

/** A server doc with one chat line, plus a client replica of it. */
function pair() {
  const server = new Y.Doc();
  server.getArray("chat").push([{ sender: "p1", text: "hello", t: 1 }]);
  server.getMap("objects");
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  return { server, client };
}
const capture = (doc: Y.Doc, fn: () => void) => {
  let out = new Uint8Array();
  doc.on("update", (u: Uint8Array) => (out = u));
  fn();
  return out;
};

test("a client cannot insert into the chat log", () => {
  const { server, client } = pair();
  const update = capture(client, () => client.getArray("chat").push([{ sender: "someone-else", text: "forged", t: 2 }]));
  assert.equal(touchesChat(server, update), true);
});

test("a client cannot delete chat lines", () => {
  const { server, client } = pair();
  const update = capture(client, () => client.getArray("chat").delete(0, 1));
  assert.equal(touchesChat(server, update), true);
});

test("ordinary world edits still go through", () => {
  const { server, client } = pair();
  const update = capture(client, () => {
    const m = new Y.Map();
    m.set("type", "cube");
    client.getMap("objects").set("obj-1", m);
  });
  assert.equal(touchesChat(server, update), false);
  const del = capture(client, () => client.getMap("objects").delete("obj-1"));
  assert.equal(touchesChat(server, del), false);
});
