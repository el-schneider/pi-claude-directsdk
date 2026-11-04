/**
 * Loopback relay between Claude Code and the Anthropic API.
 *
 * Claude Code adds its own context to the request messages (see
 * `native-context.ts`). The Agent SDK has no option to turn that off, so the
 * child reaches the API through this relay: it points `ANTHROPIC_BASE_URL` at
 * a random path on 127.0.0.1, and the relay strips the context from each
 * `POST /v1/messages` body before forwarding it. Every other request and every
 * response pass through unchanged, including the CLI's own auth headers.
 *
 * One relay serves all sessions of the Pi process. It holds no credentials and
 * no per-session state; the random path only keeps other local clients out.
 *
 * Failure behaviour stays native: a dropped upstream connection drops the
 * child's connection too, so Claude Code retries and reports it exactly as
 * without the relay. A request the relay cannot rewrite fails with a 400 that
 * names the reason, and is never forwarded unstripped.
 */

import { randomUUID } from "node:crypto";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { stripNativeContext } from "./native-context.js";

const HOP_BY_HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive"]);

const relays = new Map<string, Promise<string>>();

/** Base URL for the child's `ANTHROPIC_BASE_URL`. Starts the relay on first use. */
export function relayUrl(upstream: string): Promise<string> {
  let url = relays.get(upstream);
  if (!url) {
    url = startRelay(new URL(upstream));
    // A failed bind must not stick: the next call tries again.
    url.catch(() => relays.delete(upstream));
    relays.set(upstream, url);
  }
  return url;
}

function startRelay(upstream: URL): Promise<string> {
  const route = `/${randomUUID()}`;
  const server = createServer((req, res) => handle(req, res, route, upstream));
  // The relay must never keep the Pi process alive on its own.
  server.unref();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Claude DirectSDK relay failed to bind"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}${route}`);
    });
  });
}

function handle(req: IncomingMessage, res: ServerResponse, route: string, upstream: URL): void {
  const url = req.url ?? "/";
  if (!url.startsWith(`${route}/`)) {
    req.resume();
    res.writeHead(404, { Connection: "close" }).end();
    return;
  }
  const path = url.slice(route.length);
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("error", () => res.destroy());
  req.on("end", () => {
    let body: Buffer = Buffer.concat(chunks);
    if (req.method === "POST" && new URL(path, "http://relay").pathname === "/v1/messages") {
      try {
        body = rewriteMessagesBody(body, req.headers["content-encoding"]);
      } catch (error) {
        reject(res, error instanceof Error ? error.message : String(error));
        return;
      }
    }
    forward(req, res, upstream, path, body);
  });
}

/** Strip Claude Code context from one Messages request body. */
export function rewriteMessagesBody(body: Buffer, contentEncoding?: string | string[]): Buffer {
  if (contentEncoding !== undefined && contentEncoding !== "identity") {
    throw new Error(`Claude Code sent a ${String(contentEncoding)}-encoded request; the relay cannot rewrite it`);
  }
  const payload = JSON.parse(body.toString("utf8")) as { messages?: unknown };
  stripNativeContext(payload);
  return Buffer.from(JSON.stringify(payload));
}

/** Answer the child with an API-shaped 400 so Claude Code reports the reason and does not retry. */
function reject(res: ServerResponse, message: string): void {
  const body = JSON.stringify({
    type: "error",
    error: { type: "invalid_request_error", message: `pi-claude-directsdk relay: ${message}` },
  });
  res.writeHead(400, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Connection: "close" });
  res.end(body);
}

function forward(req: IncomingMessage, res: ServerResponse, upstream: URL, path: string, body: Buffer): void {
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(key)) headers[key] = value;
  }
  headers["content-length"] = String(body.length);
  const send = upstream.protocol === "https:" ? httpsRequest : httpRequest;
  const out = send(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || undefined,
      path: `${upstream.pathname.replace(/\/$/u, "")}${path}`,
      method: req.method,
      headers,
    },
    (answer) => {
      const passthrough: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(answer.headers)) {
        if (value !== undefined && !HOP_BY_HOP.has(key)) passthrough[key] = value;
      }
      res.writeHead(answer.statusCode ?? 502, passthrough);
      answer.pipe(res);
      answer.on("error", () => res.destroy());
    },
  );
  // Mirror connection failures both ways, so each side sees what it would see without the relay.
  out.on("error", () => res.destroy());
  res.on("close", () => {
    if (!res.writableFinished) out.destroy();
  });
  out.end(body);
}
