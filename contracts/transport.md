# Native transport boundary

The application schema does not define chat or approvals. This UI pins `@ag-ui/client` / `@ag-ui/core` 1.0.2 and CopilotKit 1.79.0. Compatibility is an observed wire behavior, not a requirement that independently packaged adapters share a version number.

## Compatible endpoint behavior

Accept native AG-UI `RunAgentInput` at one configured server endpoint. New threads seed the original scene. An empty-message request with no resume must only hydrate state/history; it must not invoke a model or replay a mutation. Emit native `STATE_SNAPSHOT` / `STATE_DELTA` data with application state under `scene`.

Persist conversation history on the server. The UI's supported `messageFilter` sends only the latest new user message on ordinary turns, and no replayed assistant/tool history on resume. Treat browser state, tools, context and forwarded properties as untrusted. Only the validated top-level selection hint is application input; incoming scene arrays are not replacement authority.

Native pending tool approval uses `RUN_FINISHED.outcome.type = "interrupt"` with the original interrupt id and tool call identity. Provide exact original arguments through native tool events or the native framework metadata. Advertise the actual expected response in `interrupt.responseSchema`.

The UI uses CopilotKit's `useInterrupt.resolve` to produce the standard `resume` array with `status: "resolved"`. It sends `{approved}` unless the native response schema declares `toolCall`, in which case it also includes the original `{callId, name, arguments}`. It never offers edited arguments, strips nullable edit values, generates new approval identity, or maintains a second approval registry. The endpoint must never execute altered client arguments or apply stale, foreign or replayed approvals as a new edit.

Reject sends `approved: false` in that schema's native payload. Active-run cancellation is separate. Cancellation after a server commit cannot imply rollback; hydrate the authoritative state to recover the outcome.

## Reconnect and persistence

CopilotKit's in-memory runner can reconnect to cached native events without starting a run. On browser reload, reconnect is completed before the chat is mounted; new threads or an empty runtime cache use the endpoint's empty-message hydration. Do not race connect and run on the same native client.

The endpoint must either recover pending native interrupts safely or explicitly invalidate them after restart and report that reset. It must retain the authoritative committed scene or clearly report state loss. The UI runtime is not a second durable conversation database.

A committed state event, not an approval click or model text, is the authority for displaying changed objects.

Sources: [AG-UI interrupts](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/interrupts.mdx), [native approval integration](https://learn.microsoft.com/en-us/agent-framework/integrations/by-component/ui/ag-ui/human-in-the-loop), and the installed package declarations and integration checks.
