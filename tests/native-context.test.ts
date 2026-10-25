import assert from "node:assert/strict";
import test from "node:test";
import { rewriteNativeSystemMessages } from "../src/transcript.ts";

// Shapes captured from Claude Code 2.1.306 requests at the relay boundary.
const CACHE = { type: "ephemeral", ttl: "1h" };
const REMINDER =
  "<system-reminder>\nAs you answer the user's questions, you can use the following context:\n" +
  "# userEmail\nThe user's email address is someone@example.com. Use it only to identify the user.\n\n" +
  "Claude Code attached this context automatically; it isn't part of the user's message. " +
  "It describes the user's own account and workspace, so they don't need it reported back.\n" +
  "</system-reminder>\n";
const ENVIRONMENT =
  "# Environment\nYou have been invoked in the following environment: \n" +
  " - Primary working directory: /home/someone/.cache/pi-claude-directsdk/child\n" +
  " - Is a git repository: false\n\nToday's date is 2026-01-01.";

function rewrite(messages: unknown[]): unknown[] {
  const body = Buffer.from(JSON.stringify({ system: [{ type: "text", text: "pi" }], messages }));
  const out = JSON.parse(rewriteNativeSystemMessages(body, []).toString("utf8")) as {
    system: unknown;
    messages: unknown[];
  };
  assert.deepEqual(out.system, [{ type: "text", text: "pi" }]);
  return out.messages;
}

test("first turn keeps only Pi's prompt and moves the tail breakpoint onto it", () => {
  const messages = rewrite([
    { role: "user", content: [{ type: "text", text: REMINDER }, { type: "text", text: "go" }] },
    { role: "system", content: [{ type: "text", text: ENVIRONMENT, cache_control: CACHE }] },
  ]);
  assert.deepEqual(messages, [
    { role: "user", content: [{ type: "text", text: "go", cache_control: CACHE }] },
  ]);
});

test("later turns drop the reminder appended to a tool result", () => {
  const messages = rewrite([
    { role: "user", content: [{ type: "text", text: "go", cache_control: CACHE }] },
    { role: "system", content: ENVIRONMENT },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "bash", input: {} }] },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: `hello\n\n${REMINDER}` }],
    },
    { role: "system", content: [{ type: "text", text: "Today's date is 2026-01-01.", cache_control: CACHE }] },
  ]);
  assert.deepEqual(messages, [
    { role: "user", content: [{ type: "text", text: "go", cache_control: CACHE }] },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "bash", input: {} }] },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "hello\n", cache_control: CACHE }],
    },
  ]);
});

test("drops the reminder from tool result text blocks and from user text", () => {
  const messages = rewrite([
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: [{ type: "text", text: "a" }, { type: "text", text: REMINDER }],
        },
        { type: "text", text: `next\n${REMINDER}` },
      ],
    },
  ]);
  assert.deepEqual(messages, [
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "a" }] },
        { type: "text", text: "next" },
      ],
    },
  ]);
});

test("keeps reminders that Pi content quotes inside a larger text", () => {
  const quoted = `The CLI wraps context like this:\n<system-reminder>\nfoo\n</system-reminder>\nend`;
  const content = [{ type: "text", text: quoted }];
  assert.deepEqual(rewrite([{ role: "user", content }]), [{ role: "user", content }]);
});

test("fails loud on a CLI reminder block in an unknown format", () => {
  const body = Buffer.from(
    JSON.stringify({
      messages: [{ role: "user", content: [{ type: "text", text: "<system-reminder>\nnew\n</system-reminder>\n" }] }],
    }),
  );
  assert.throws(() => rewriteNativeSystemMessages(body, []), { name: "NativeContextError" });
});

test("keeps Pi tool-change injections that follow the strip", () => {
  const body = Buffer.from(
    JSON.stringify({
      messages: [
        { role: "user", content: [{ type: "text", text: "go" }] },
        { role: "system", content: ENVIRONMENT },
      ],
    }),
  );
  const injected = [{ type: "text", text: "beta is available" }];
  const out = JSON.parse(
    rewriteNativeSystemMessages(body, [{ beforeAssistant: null, content: injected }]).toString("utf8"),
  ) as { messages: unknown[] };
  assert.deepEqual(out.messages, [
    { role: "user", content: [{ type: "text", text: "go" }] },
    { role: "system", content: injected },
  ]);
});
