#!/usr/bin/env node
/**
 * Compare the upstream `messages` of this provider with Pi's built-in
 * Anthropic provider for the same two-turn tool conversation.
 *
 * Both runs talk to a local fake Messages endpoint, so no paid request is made.
 * The fake answers turn one with a bash tool call and turn two with text. The
 * script prints both message lists after normalizing ids, tool-name prefixes,
 * cache breakpoints, and default `is_error`, and exits 1 when they differ.
 *
 * Requires a logged-in `claude` CLI and a DirectSDK model catalog snapshot in
 * the default Pi agent directory (open `/model` once).
 *
 * Usage: node scripts/compare-messages.mjs [model-id]
 */

import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const model = process.argv[2] ?? "claude-haiku-5-5";
const extension = join(dirname(fileURLToPath(import.meta.url)), "../extensions/claude-directsdk/index.ts");
const work = mkdtempSync(join(tmpdir(), "directsdk-compare-"));
const cwd = join(work, "cwd");
mkdirSync(cwd);
writeFileSync(join(cwd, "a.txt"), "hello\n");
const prompt = "Run 'cat a.txt' with bash, then reply with its content only.";

let captureDir = "";
const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!req.url?.includes("/messages")) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(raw);
    writeFileSync(join(captureDir, `${readdirSync(captureDir).length}.json`), raw);
    const bash = body.tools?.find((t) => t.name === "bash" || t.name.endsWith("__bash"))?.name ?? "bash";
    const answered = raw.includes('"tool_result"');
    const block = answered
      ? [
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
        ]
      : [
          { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: bash, input: {} } },
          { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"command":"cat a.txt"}' } },
        ];
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      sse([
        { type: "message_start", message: { id: "m", type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } },
        ...block,
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: answered ? "end_turn" : "tool_use" }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ]),
    );
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const upstream = `http://127.0.0.1:${server.address().port}`;

function run(name, args, env) {
  captureDir = join(work, name);
  mkdirSync(captureDir);
  return new Promise((resolve, reject) => {
    // Async spawn keeps the fake server responsive while Pi runs.
    import("node:child_process").then(({ spawn }) => {
      const child = spawn("pi", ["-ne", "--no-session", "-p", prompt, ...args], {
        cwd,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (output += d));
      child.on("close", (code) => {
        if (code !== 0) reject(new Error(`${name} run failed (${code}):\n${output}`));
        const files = readdirSync(captureDir).sort((a, b) => parseInt(a) - parseInt(b));
        resolve(files.map((f) => JSON.parse(readFileSync(join(captureDir, f), "utf8"))));
      });
    });
  });
}

/** Drop transport details that legitimately differ between providers. */
function normalize(messages) {
  return JSON.parse(
    JSON.stringify(messages, (key, value) => {
      if (key === "cache_control") return undefined;
      // DirectSDK replay omits the default `is_error: false`.
      if (key === "is_error" && value === false) return undefined;
      if ((key === "id" || key === "tool_use_id") && typeof value === "string") return "<id>";
      if (key === "name" && typeof value === "string") return value.replace(/^mcp__pi__/u, "");
      return value;
    }),
  ).map((m) => (typeof m.content === "string" ? { ...m, content: [{ type: "text", text: m.content }] } : m));
}

const agentDir = join(work, "agent");
mkdirSync(agentDir);
writeFileSync(
  join(agentDir, "models.json"),
  JSON.stringify({
    providers: {
      fake: { baseUrl: upstream, api: "anthropic-messages", apiKey: "dummy", models: [{ id: model, name: "fake", contextWindow: 200000, maxTokens: 8000 }] },
    },
  }),
);

try {
  const reference = await run("reference", ["--model", `fake/${model}`], { PI_CODING_AGENT_DIR: agentDir });
  const directsdk = await run("directsdk", ["-e", extension, "--model", `claude-directsdk/${model}`], {
    ANTHROPIC_BASE_URL: upstream,
    PI_DIRECTSDK_TEST_UPSTREAM: "1",
  });
  assert.equal(directsdk.length, reference.length, "request count differs");
  let same = true;
  reference.forEach((ref, i) => {
    const a = normalize(ref.messages);
    const b = normalize(directsdk[i].messages);
    const equal = JSON.stringify(a) === JSON.stringify(b);
    same &&= equal;
    console.log(`request ${i + 1}: ${equal ? "same" : "DIFFERENT"}`);
    if (!equal) {
      console.log("  pi anthropic:", JSON.stringify(a));
      console.log("  directsdk:   ", JSON.stringify(b));
    }
  });
  console.log(`captures: ${work}`);
  process.exitCode = same ? 0 : 1;
} finally {
  server.close();
}
