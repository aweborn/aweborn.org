import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSdp, buildSdp, encodeSignal, decodeSignal, signalToText, textToSignal, MESH_ANSWER_PREFIX } from "./mesh-signal.ts";

// Captured from headless Chrome (data channel only, no STUN): mDNS host candidates
const OFFER =
  "v=0\r\no=- 5819089910219203727 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=candidate:3980320329 1 udp 2113937151 613ba9f0-e6ac-41a0-b4aa-692fe5030fd2.local 58835 typ host generation 0 network-cost 999\r\na=candidate:1533923767 1 udp 2113939711 b3152236-37c9-4d6e-abb5-92a6e783153b.local 53666 typ host generation 0 network-cost 999\r\na=ice-ufrag:N5VZ\r\na=ice-pwd:u3W47yZE/eZS3UGbK1vuATKf\r\na=ice-options:trickle\r\na=fingerprint:sha-256 8B:BF:F1:44:CC:5D:C4:E8:59:F2:C8:03:AE:1C:8B:7A:D2:68:87:40:98:64:3F:92:53:32:92:48:80:57:05:FB\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n";
const ANSWER =
  "v=0\r\no=- 5388385234998377000 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=candidate:1715865808 1 udp 2113937151 613ba9f0-e6ac-41a0-b4aa-692fe5030fd2.local 60264 typ host generation 0 network-cost 999\r\na=ice-ufrag:S06v\r\na=ice-pwd:+05SA7zWzFC5EDVKkDIScgcl\r\na=ice-options:trickle\r\na=fingerprint:sha-256 B2:3F:94:5D:16:80:0E:12:0B:D9:A4:14:E1:0F:6F:8C:4B:CA:BD:B7:11:F5:3D:44:7F:AF:BE:C1:60:B1:D7:F8\r\na=setup:active\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n";
const WORLD = "9f974b8f-ffde-448b-bbfe-c93f8a745e21";

test("offer round-trips through bytes with the world id, small enough for an easy QR", () => {
  const s = { ...parseSdp(OFFER, "offer"), worldId: WORLD };
  assert.equal(s.candidates.length, 2);
  const bytes = encodeSignal(s);
  assert.ok(bytes.length <= 130, `packed ${bytes.length} bytes`);
  assert.deepEqual(decodeSignal(bytes), s);
  const url = signalToText(s, "https://aweborn.org");
  assert.match(url, /^https:\/\/aweborn\.org\/j#[A-Za-z0-9_-]+$/);
  assert.ok(url.length <= 200, `url ${url.length} chars`);
  assert.deepEqual(textToSignal(url), s);
});

test("answer keeps its DTLS role and is plain text (never a URL)", () => {
  const s = parseSdp(ANSWER, "answer");
  assert.equal(s.setup, "active");
  const text = signalToText(s, "https://aweborn.org");
  assert.ok(text.startsWith(MESH_ANSWER_PREFIX));
  const back = textToSignal(text);
  assert.deepEqual(back, s);
  assert.equal(back.worldId, undefined);
});

test("rebuilt SDP carries the values a browser needs", () => {
  const s = parseSdp(OFFER, "offer");
  const sdp = buildSdp(s);
  for (const needle of [
    "a=ice-ufrag:N5VZ",
    "a=ice-pwd:u3W47yZE/eZS3UGbK1vuATKf",
    "a=fingerprint:sha-256 8B:BF:F1",
    "a=setup:actpass",
    "a=mid:0",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "613ba9f0-e6ac-41a0-b4aa-692fe5030fd2.local 58835 typ host",
  ]) {
    assert.ok(sdp.includes(needle), needle);
  }
  assert.deepEqual(parseSdp(sdp, "offer"), s); // stable
});

test("IPv4, IPv6 and srflx candidates pack and unpack", () => {
  const s = parseSdp(OFFER, "offer");
  s.candidates = [
    { type: "host", address: "192.168.1.23", port: 50000 },
    { type: "host", address: "fe80::1c2b:3aff:fe4d:5e6f", port: 50001 },
    { type: "srflx", address: "203.0.113.9", port: 61000 },
  ];
  const back = decodeSignal(encodeSignal(s));
  assert.equal(back.candidates[0]!.address, "192.168.1.23");
  assert.equal(back.candidates[1]!.address, "fe80:0:0:0:1c2b:3aff:fe4d:5e6f");
  assert.equal(back.candidates[2]!.type, "srflx");
  assert.ok(buildSdp(back).includes("203.0.113.9 61000 typ srflx raddr 0.0.0.0 rport 0"));
});

test("junk is rejected, not half-parsed", () => {
  for (const junk of ["", "hello", "https://aweborn.org/w/abc", "AWB1:", "AWB1:AAAA", "https://example.com/j#////"]) {
    assert.throws(() => textToSignal(junk), junk);
  }
  const bytes = encodeSignal(parseSdp(OFFER, "offer"));
  assert.throws(() => decodeSignal(bytes.subarray(0, bytes.length - 1)));
  assert.throws(() => decodeSignal(Uint8Array.from([...bytes, 0])));
  assert.throws(() => parseSdp(OFFER.replace("sha-256", "sha-1"), "offer"));
  assert.throws(() => parseSdp(OFFER, "answer"));
});
