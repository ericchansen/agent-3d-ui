import type { Interrupt, Message } from "@ag-ui/core";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function pendingCall(interrupt: Interrupt, messages: Message[]) {
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const call = message.toolCalls?.find((tool) => tool.id === interrupt.toolCallId);
    if (call) return { callId: call.id, name: call.function.name, arguments: JSON.parse(call.function.arguments) as unknown };
  }
  const metadata: unknown = interrupt.metadata;
  if (isRecord(metadata) && isRecord(metadata.agent_framework) && isRecord(metadata.agent_framework.function_call)) {
    const call = metadata.agent_framework.function_call;
    if (typeof call.name === "string" && typeof call.call_id === "string" && call.call_id === interrupt.toolCallId) {
      return { callId: call.call_id, name: call.name, arguments: call.arguments };
    }
  }
  throw new Error("The native interrupt does not expose the exact pending tool arguments.");
}

export function approvalPayload(interrupt: Interrupt, messages: Message[], approved: boolean) {
  const schema: unknown = interrupt.responseSchema;
  if (!isRecord(schema) || !isRecord(schema.properties) || !("approved" in schema.properties)) {
    throw new Error("This interrupt does not advertise a supported approval response.");
  }
  return "toolCall" in schema.properties ? { approved, toolCall: pendingCall(interrupt, messages) } : { approved };
}
