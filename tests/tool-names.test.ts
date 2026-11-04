import assert from "node:assert/strict";
import test from "node:test";
import type { Tool } from "@earendil-works/pi-ai/compat";
import { prepareToolSpecs, toolPrefixedName } from "../src/sdk/tools.ts";

const tool = (name: string): Tool => ({
  name,
  description: name,
  parameters: { type: "object", properties: {} },
});

test("accepts tool names whose prefixed form fits the 128-character API limit", () => {
  // Real MCP tool name that the earlier 50-character cap rejected.
  const mcpName = "mcp__agent_browser__agent_browser_wait_for_selector";
  const longest = "t".repeat(119);
  const specs = prepareToolSpecs([tool(mcpName), tool(longest)]);
  assert.deepEqual(specs.map((spec) => spec.name), [mcpName, longest]);
  assert.equal(toolPrefixedName(longest).length, 128);
});

test("rejects a name whose prefixed form exceeds 128 characters before any request", () => {
  assert.throws(() => prepareToolSpecs([tool("t".repeat(120))]), /at most 119 characters/);
});

test("rejects names the API cannot accept", () => {
  assert.throws(() => prepareToolSpecs([tool("has space")]), /ASCII identifiers/);
  assert.throws(() => prepareToolSpecs([tool("")]), /ASCII identifiers/);
});
