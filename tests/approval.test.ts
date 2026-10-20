import { expect, it } from "vitest";
import type { Interrupt, Message } from "@ag-ui/core";
import { approvalPayload, pendingCall } from "../src/approval";
import { previewEdit, readState } from "../src/scene";
import seed from "../contracts/fixtures/seed.scene.json";

const args = { ids: ["box-01"], expectedRevision: 0, edit: { color: "#16A34A", position: null } };
const messages: Message[] = [{
  id: "assistant-1", role: "assistant",
  toolCalls: [{ id: "call-1", type: "function", function: { name: "edit_objects", arguments: JSON.stringify(args) } }],
}];
const interrupt: Interrupt = {
  id: "approval-1", reason: "tool_call", toolCallId: "call-1",
  responseSchema: { type: "object", properties: { approved: { type: "boolean" } }, required: ["approved"] },
};

it("uses the advertised native response shape without editing approved arguments", () => {
  expect(approvalPayload(interrupt, messages, true)).toEqual({ approved: true });
  const full = { ...interrupt, responseSchema: { properties: { approved: {}, toolCall: {} } } };
  expect(approvalPayload(full, messages, false)).toEqual({
    approved: false, toolCall: { callId: "call-1", name: "edit_objects", arguments: args },
  });
  expect(pendingCall(interrupt, messages).arguments).toEqual(args);
});

it("reads native metadata when no tool message is emitted, but rejects mismatched call identity", () => {
  const pending = { ...interrupt, metadata: { agent_framework: { function_call: {
    call_id: "call-1", name: "load_skill", arguments: { name: "inspect-scene" },
  } } } };
  expect(pendingCall(pending, [])).toEqual({ callId: "call-1", name: "load_skill", arguments: { name: "inspect-scene" } });
  pending.metadata.agent_framework.function_call.call_id = "other";
  expect(() => pendingCall(pending, [])).toThrow("exact pending");
});

it("does not guess responses to unsupported native interrupt schemas", () => {
  expect(() => approvalPayload({ ...interrupt, responseSchema: {} }, messages, true)).toThrow("supported approval");
});

it("can reject the exact original native call even when its preview is stale", () => {
  const scene = readState({ scene: { ...seed, revision: 1 } }).scene;
  expect(() => previewEdit(scene, pendingCall(interrupt, messages).arguments)).toThrow("Scene changed");
  const full = { ...interrupt, responseSchema: { properties: { approved: {}, toolCall: {} } } };
  expect(approvalPayload(full, messages, false)).toEqual({
    approved: false, toolCall: { callId: "call-1", name: "edit_objects", arguments: args },
  });
});
