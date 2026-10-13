/** Shared connection pools; admission and authentication stay request-scoped. */
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";

const options = {
  keepAlive: true,
  maxFreeSockets: 2,
};

// Node keys pooled sockets by destination and TLS settings. No credentials or
// request headers are supplied to the agents. Idle pooled sockets are unrefed.
const httpAgent = new HttpAgent(options);
const httpsAgent = new HttpsAgent({ ...options, maxCachedSessions: 16 });

process.once("exit", () => {
  httpAgent.destroy();
  httpsAgent.destroy();
});

export function upstreamAgent(scheme: "https:" | "http:"): HttpAgent {
  return scheme === "https:" ? httpsAgent : httpAgent;
}
