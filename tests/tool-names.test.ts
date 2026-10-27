import assert from "node:assert/strict";
import test from "node:test";
import type { Tool } from "@earendil-works/pi-ai/compat";
import { prepareTools, toolBareName } from "../src/request.ts";

const tool = (name: string): Tool => ({
  name,
  description: name,
  parameters: { type: "object", properties: {} },
});

test("accepts tool names whose native form fits the 128-character API limit", () => {
  // Real MCP tool name that the earlier 50-character cap rejected.
  const mcpName = "mcp__agent_browser__agent_browser_wait_for_selector";
  const longest = "t".repeat(119);
  const prepared = prepareTools([tool(mcpName), tool(longest)]);
  const native = prepared.nativeTools.map((t) => String(t.name));
  assert.deepEqual(native.map(toolBareName), [mcpName, longest]);
  assert.equal(native[1]!.length, 128);
});

test("rejects a name whose native form exceeds 128 characters before any request", () => {
  assert.throws(() => prepareTools([tool("t".repeat(120))]), /at most 119 characters/);
});

test("rejects names the API cannot accept", () => {
  assert.throws(() => prepareTools([tool("has space")]), /ASCII identifiers/);
  assert.throws(() => prepareTools([tool("")]), /ASCII identifiers/);
});
