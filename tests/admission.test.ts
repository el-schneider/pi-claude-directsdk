import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { AdmissionRelay, describeTransportFailure } from "../src/admission.ts";
import { NATIVE_TOOL_CHANGES_BETA } from "../src/transcript.ts";

test("admits one upstream request and applies the tool-change beta and rewrite", async (t) => {
  let upstreamRequests = 0;
  let seenBeta = "";
  let seenBody: Record<string, unknown> | undefined;
  const upstream = createServer((request, response) => {
    upstreamRequests += 1;
    seenBeta = String(request.headers["anthropic-beta"] ?? "");
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      seenBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        'data: {"type":"message_start","message":{"role":"assistant","content":[],"usage":{"input_tokens":1,"output_tokens":1}}}\n\n' +
          'data: {"type":"message_stop"}\n\n',
      );
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const relay = await AdmissionRelay.create(
    `http://127.0.0.1:${address.port}`,
    5_000,
    {
      transformRequest: (body) => {
        const payload = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
        payload["rewritten"] = true;
        return Buffer.from(JSON.stringify(payload));
      },
      betas: [NATIVE_TOOL_CHANGES_BETA],
    },
  );
  t.after(() => relay.close());

  const first = await fetch(`${relay.url}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-beta": "existing-beta",
    },
    body: JSON.stringify({ messages: [] }),
  });
  assert.equal(first.status, 200);
  await first.text();
  assert.equal(upstreamRequests, 1);
  assert.equal(seenBeta, `existing-beta,${NATIVE_TOOL_CHANGES_BETA}`);
  assert.equal(seenBody?.["rewritten"], true);

  const second = await fetch(`${relay.url}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  });
  assert.equal(second.status, 400);
  assert.match(await second.text(), /PI_MODEL_ADMISSION_CONSUMED/);
  assert.equal(upstreamRequests, 1);
  assert.equal(relay.used, true);
  assert.equal(relay.denied, 1);
});

// Transport failures must be described in words Pi's retry classifier knows (it matches
// "connection error", "ECONNRESET", "socket hang up", ...); a bare class name is not retried.
test("describes transport failures so Pi retries them", async (t) => {
  const upstream = createServer((request) => {
    request.socket.destroy();
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => upstream.close(() => resolve())));
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const relay = await AdmissionRelay.create(`http://127.0.0.1:${address.port}`, 5_000);
  t.after(() => relay.close());

  const response = await fetch(`${relay.url}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  });
  await response.text();
  assert.equal(response.status, 502);
  assert.match(relay.failure ?? "", /^connection error \(Error ECONNRESET/);

  const aggregate = new AggregateError([new Error("connect ETIMEDOUT 1.2.3.4:443")], "");
  assert.equal(describeTransportFailure(aggregate), "connection error (AggregateError: connect ETIMEDOUT 1.2.3.4:443)");
});

// Anthropic reports mid-stream failures (e.g. overloaded_error) as an SSE `error`
// event inside an HTTP 200 response. The capture must keep that reason so the
// provider can surface it (and Pi can classify it as retryable) instead of a
// bare "capture incomplete".
test("keeps the upstream error event of a 200 stream", async (t) => {
  const upstream = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        'event: message_start\ndata: {"type":"message_start","message":{"role":"assistant","content":[],"usage":{"input_tokens":1,"output_tokens":1}}}\n\n' +
          'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
      );
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => upstream.close(() => resolve())));
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const relay = await AdmissionRelay.create(`http://127.0.0.1:${address.port}`, 5_000);
  t.after(() => relay.close());

  const response = await fetch(`${relay.url}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(relay.capture.complete, false);
  assert.equal(relay.capture.streamError, "overloaded_error: Overloaded");
  assert.match(relay.errorText(), /overloaded_error: Overloaded/);
});
