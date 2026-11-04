import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request, type IncomingMessage } from "node:http";
import test from "node:test";
import { stripNativeContext } from "../src/native-context.ts";
import { relayUrl } from "../src/relay.ts";

// Shapes captured from Claude Code 2.1.300 through the Agent SDK; personal values replaced.
const CACHE = { type: "ephemeral", ttl: "1h" };
const ENVIRONMENT_SECTION =
  "# Environment\nYou have been invoked in the following environment: \n" +
  " - Primary working directory: /home/someone/project\n - Is a git repository: true\n - Platform: linux";
const MODEL_SECTION =
  "You are powered by the model named Haiku 4.5. The exact model ID is claude-haiku-4-5-20251001. " +
  "Assistant knowledge cutoff is February 2025.";
const DATE_SECTION = "Today's date is 2026-01-01.";
const reminder = (body: string): string => `<system-reminder>\n${body}\n</system-reminder>`;
const USER_CONTEXT =
  "<system-reminder>\nAs you answer the user's questions, you can use the following context:\n" +
  "# userEmail\nThe user's email address is someone@example.com.\n" +
  "# gitStatus\nThis is the git status at the start of the conversation.\n\nCurrent branch: main\n\n" +
  "Claude Code attached this context automatically; it isn't part of the user's message. " +
  "It describes the user's own account and workspace, so they don't need it reported back.\n" +
  "</system-reminder>";

function strip(messages: unknown[]): unknown[] {
  const payload = { system: [{ type: "text", text: "pi" }], messages };
  stripNativeContext(payload);
  assert.deepEqual(payload.system, [{ type: "text", text: "pi" }]);
  return payload.messages;
}

test("first turn keeps only Pi's prompt when every context section is a reminder block", () => {
  const messages = strip([
    {
      role: "user",
      content: [
        { type: "text", text: reminder(ENVIRONMENT_SECTION) },
        { type: "text", text: reminder(MODEL_SECTION) },
        { type: "text", text: USER_CONTEXT },
        { type: "text", text: `${reminder(DATE_SECTION)}\n` },
        { type: "text", text: "go", cache_control: CACHE },
      ],
    },
  ]);
  assert.deepEqual(messages, [{ role: "user", content: [{ type: "text", text: "go", cache_control: CACHE }] }]);
});

test("drops the context system message and moves its breakpoint onto Pi's prompt", () => {
  const messages = strip([
    { role: "user", content: [{ type: "text", text: USER_CONTEXT }, { type: "text", text: "go" }] },
    {
      role: "system",
      content: [{ type: "text", text: `${ENVIRONMENT_SECTION}\n\n${MODEL_SECTION}\n\n${DATE_SECTION}`, cache_control: CACHE }],
    },
  ]);
  assert.deepEqual(messages, [{ role: "user", content: [{ type: "text", text: "go", cache_control: CACHE }] }]);
});

test("later turns drop string system messages and the reminder appended to a tool result", () => {
  const messages = strip([
    { role: "user", content: [{ type: "text", text: "go" }] },
    { role: "system", content: `${ENVIRONMENT_SECTION}\n\n${DATE_SECTION}` },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "mcp__pi__bash", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: `hello\n\n${USER_CONTEXT}\n` }] },
  ]);
  assert.deepEqual(messages, [
    { role: "user", content: [{ type: "text", text: "go" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "mcp__pi__bash", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "hello\n" }] },
  ]);
});

test("keeps reminders that Pi content quotes inside a larger text", () => {
  const content = [{ type: "text", text: `The CLI wraps context like this:\n${reminder(DATE_SECTION)}\nend` }];
  assert.deepEqual(strip([{ role: "user", content }]), [{ role: "user", content }]);
});

test("fails loud on context in an unknown format instead of forwarding it", () => {
  assert.throws(() => strip([{ role: "user", content: [{ type: "text", text: reminder("# newSection\nsomething") }] }]), {
    name: "NativeContextError",
  });
  assert.throws(() => strip([{ role: "system", content: "Something new" }]), { name: "NativeContextError" });
});

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function send(url: string, method: string, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers: { authorization: "Bearer token", "content-type": "application/json" } }, async (res) => {
      resolve({ status: res.statusCode ?? 0, body: await readBody(res) });
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("relay strips Messages bodies, forwards everything else unchanged, and rejects unknown context", async (t) => {
  const seen: Array<{ method: string; url: string; auth: string | undefined; body: string }> = [];
  const upstream = createServer(async (req, res) => {
    seen.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, body: await readBody(req) });
    res.writeHead(200, { "content-type": "application/json", "request-id": "req_1" }).end('{"ok":true}');
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => upstream.close());
  const address = upstream.address();
  assert.ok(address && typeof address === "object");
  const base = await relayUrl(`http://127.0.0.1:${address.port}/prefix`);

  const messages = [{ role: "user", content: [{ type: "text", text: USER_CONTEXT }, { type: "text", text: "go" }] }];
  const answer = await send(`${base}/v1/messages?beta=true`, "POST", JSON.stringify({ model: "m", messages }));
  assert.deepEqual(answer, { status: 200, body: '{"ok":true}' });
  assert.equal(seen[0]?.url, "/prefix/v1/messages?beta=true");
  assert.equal(seen[0]?.auth, "Bearer token");
  assert.deepEqual(JSON.parse(seen[0]?.body ?? ""), {
    model: "m",
    messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
  });

  await send(`${base}/v1/messages/count_tokens`, "POST", '{"raw": true}');
  assert.equal(seen[1]?.body, '{"raw": true}');

  const unknown = [{ role: "user", content: [{ type: "text", text: reminder("# newSection") }] }];
  const refused = await send(`${base}/v1/messages`, "POST", JSON.stringify({ messages: unknown }));
  assert.equal(refused.status, 400);
  assert.match(refused.body, /unknown format/);
  assert.equal(seen.length, 2, "a request with unknown context must never reach upstream");

  // Other local clients cannot use the relay without its random path.
  assert.equal((await send(new URL("/v1/messages", base).href, "POST", "{}")).status, 404);
});
