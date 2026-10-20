import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { CopilotChat, CopilotChatConfigurationProvider, CopilotKitProvider, useAgent, useCopilotKit, useDefaultRenderTool, useInterrupt } from "@copilotkit/react-core/v2";
import type { Interrupt, Message } from "@ag-ui/core";
import { matchingIds, previewEdit, readState, type AgentState, type SceneObject, type Vector } from "./scene";
import { Viewport } from "./Viewport";
import { approvalPayload, isRecord, pendingCall } from "./approval";
import "./style.css";

const EMPTY: string[] = [];
const NO_GHOSTS: SceneObject[] = [];
const NoAddMenu = () => null;

function coordinates({ x, y, z }: Vector) {
  return `${x}, ${y}, ${z}`;
}

function lastUserMessage(messages: Message[]) {
  const last = messages.at(-1);
  return last?.role === "user" ? [last] : [];
}

function Approval({ interrupt, messages, state, resolve, onGhosts, onPendingCount }: {
  interrupt: Interrupt; messages: Message[]; state?: AgentState;
  resolve: (payload: unknown, id?: string) => Promise<unknown>;
  onGhosts: (objects: SceneObject[]) => void;
  onPendingCount: Dispatch<SetStateAction<number>>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const projection = useMemo(() => {
    let call: ReturnType<typeof pendingCall> | undefined;
    try {
      call = pendingCall(interrupt, messages);
      const changes = call.name === "edit_objects" && state ? previewEdit(state.scene, call.arguments) : undefined;
      if (call.name === "edit_objects" && !state) throw new Error("Load the authoritative scene before approving an edit.");
      return { call, changes };
    } catch (error) { return { call, error: error instanceof Error ? error.message : String(error) }; }
  }, [interrupt, messages, state]);
  useEffect(() => {
    onGhosts(projection.changes?.map((change) => change.after) ?? NO_GHOSTS);
    return () => onGhosts(NO_GHOSTS);
  }, [projection, onGhosts]);
  useEffect(() => {
    onPendingCount((count) => count + 1);
    return () => onPendingCount((count) => count - 1);
  }, [onPendingCount]);
  async function decide(approved: boolean) {
    setBusy(true);
    try {
      await resolve(approvalPayload(interrupt, messages, approved), interrupt.id);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  }
  return <section className="approval" aria-label="Pending approval">
    <h3>Review {projection.call?.name ?? "pending request"}</h3>
    <p>{projection.changes ? "Not applied yet. Review the exact changes below." : "Review this tool request before approving."}</p>
    {projection.error && <p role="alert">{projection.error}</p>}
    {projection.changes ? <table><caption className="sr-only">Exact before and after values</caption><thead><tr><th>Property</th><th>Before</th><th>After</th></tr></thead>
      {projection.changes.map(({ before, after }) => <tbody key={before.id}>
        <tr className="approval-object"><th colSpan={3}>{before.name}</th></tr>
        <tr><th scope="row">Position<br /><span className="axis-label">x, y, z</span></th>
          <td>{coordinates(before.position)}</td>
          <td data-changed={coordinates(before.position) !== coordinates(after.position)}>{coordinates(after.position)}</td></tr>
        <tr><th scope="row">Color</th>
          <td><span className="color-value"><i className="swatch" style={{ background: before.color }} /><code>{before.color}</code></span></td>
          <td data-changed={before.color !== after.color}><span className="color-value"><i className="swatch" style={{ background: after.color }} /><code>{after.color}</code></span></td></tr>
      </tbody>)}</table>
      : <pre>{JSON.stringify(projection.call?.arguments ?? interrupt, null, 2)}</pre>}
    {error && <p role="alert">{error}</p>}
    <div className="actions">
      <button className="primary-button" disabled={busy || !!projection.error} onClick={() => void decide(true)}>Approve</button>
      <button disabled={busy} onClick={() => void decide(false)}>Reject</button>
    </div>
  </section>;
}

function SceneWorkspace({ threadId, reconnect, newScene, error, onError }: {
  threadId: string; reconnect: boolean; newScene: () => void; error: string; onError: (error: string) => void;
}) {
  useDefaultRenderTool();
  const { agent, isReady } = useAgent();
  const { copilotkit } = useCopilotKit();
  const initialized = useRef(false);
  const [hydrationComplete, setHydrationComplete] = useState(false);
  const [filter, setFilter] = useState("");
  const [mobileView, setMobileView] = useState<"scene" | "assistant">("scene");
  const [selectedIds, setSelectedIds] = useState<string[]>(EMPTY);
  const selectionDirty = useRef(false);
  const [ghosts, setGhosts] = useState<SceneObject[]>(NO_GHOSTS);
  const [pendingCount, setPendingCount] = useState(0);
  const parsed = useMemo(() => {
    if (!isRecord(agent.state) || !("scene" in agent.state)) return {};
    try { return { state: readState(agent.state) }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [agent.state]);
  const state = parsed.state;
  const scene = state?.scene;
  const hydrated = hydrationComplete && !!scene;
  const failure = error || parsed.error || state?.error?.message ||
    (hydrationComplete && !scene ? "The backend did not return a scene." : "");
  const filtered = useMemo(() => scene && filter.trim() ? matchingIds(scene, filter) : EMPTY, [scene, filter]);
  const visibleObjects = scene?.objects.filter((object) => !filter.trim() || filtered.includes(object.id)) ?? [];
  const selectedObjects = scene?.objects.filter((object) => selectedIds.includes(object.id)) ?? [];
  useEffect(() => {
    if (!scene) return;
    if (!selectionDirty.current) setSelectedIds(scene.selectedIds);
    else if (scene.selectedIds.length === selectedIds.length && scene.selectedIds.every((id) => selectedIds.includes(id))) {
      selectionDirty.current = false;
    }
  }, [scene, selectedIds]);
  useEffect(() => {
    if (!isReady || initialized.current) return;
    initialized.current = true;
    agent.threadId = threadId;
    async function hydrate() {
      if (reconnect) await copilotkit.connectAgent({ agent });
      if (!isRecord(agent.state) || !("scene" in agent.state)) {
        // Native empty-message hydration seeds/reads state without invoking the model.
        await copilotkit.runAgent({ agent });
      }
      setHydrationComplete(true);
    }
    void hydrate().catch((error: Error) => onError(error.message));
  }, [agent, isReady, copilotkit, onError, threadId, reconnect]);

  useInterrupt({
    render: ({ interrupts, resolve }) => <div>{interrupts.map((interrupt) =>
      <Approval key={interrupt.id} interrupt={interrupt} messages={agent.messages} state={state}
        resolve={resolve} onGhosts={setGhosts} onPendingCount={setPendingCount} />)}</div>,
  });
  function select(id: string) {
    if (!hydrated) return;
    const ids = selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id];
    selectionDirty.current = true;
    setSelectedIds(ids);
    agent.setState({ ...agent.state, selectedIds: ids });
  }
  return <>
    <header className="masthead">
      <h1>Agent 3D</h1>
      <div className="session-actions">
        {agent.isRunning && <button className="quiet-button" onClick={() => copilotkit.stopAgent({ agent })}>Cancel run</button>}
        <button disabled={!hydrated || agent.isRunning} onClick={newScene}>New scene</button>
      </div>
    </header>
    {failure && <p role="alert" className="error">{failure}</p>}
    <nav className="workspace-tabs" aria-label="Workspace view">
      <button aria-pressed={mobileView === "scene"} onClick={() => setMobileView("scene")}>Scene</button>
      <button aria-label="Assistant" aria-describedby={pendingCount > 0 ? "approval-status" : undefined}
        aria-pressed={mobileView === "assistant"} onClick={() => setMobileView("assistant")}>
        Assistant{pendingCount > 0 && <span className="review-marker" aria-hidden="true" />}
      </button>
      <span id="approval-status" className="sr-only" role="status">{pendingCount > 0 ? "Approval required" : ""}</span>
    </nav>
    <main className="workspace" data-mobile-view={mobileView}>
      <section className="object-panel" aria-label="Scene explorer">
        <div className="panel-heading"><h2>Objects</h2><span className="count">{scene?.objects.length ?? "—"}</span></div>
        <div className="object-search">
          <label className="sr-only" htmlFor="object-filter">Filter</label>
          <input id="object-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find an object..." />
          {filter && <button aria-label="Clear filter" onClick={() => setFilter("")}>×</button>}
        </div>
        <div className="object-scroll">
          <ul className="object-list">{visibleObjects.map((object) =>
            <li key={object.id}><button disabled={!hydrated} aria-pressed={selectedIds.includes(object.id)} onClick={() => select(object.id)}>
              <span className="swatch" style={{ background: object.color }} aria-hidden="true" />
              <span className="object-name">{object.name}</span>
              {selectedIds.includes(object.id) ? <span className="object-state selected-state" title="Selected" aria-label="Selected">✓</span>
                : scene?.highlightedIds.includes(object.id) && <span className="object-state highlighted-state" title="Highlighted" aria-label="Highlighted" />}
            </button></li>)}</ul>
          {hydrated && visibleObjects.length === 0 && <div className="empty-results"><p>No matching objects</p><button onClick={() => setFilter("")}>Clear filter</button></div>}
        </div>
        {filter && <p className="object-help">{visibleObjects.length} matching · outlines only</p>}
        {selectedObjects.length > 0 && <section className="inspector" aria-label="Object inspector">
          <h2 className="panel-heading">Inspector</h2>
          {selectedObjects.map((object) =>
            <div className="inspected-object" key={object.id}>
              <h3>{object.name}</h3>
              <dl className="properties">
                <dt>Object</dt><dd>{object.id}</dd>
                <dt>Shape</dt><dd>{object.shape}</dd>
                <dt>Position (x, y, z)</dt><dd>{coordinates(object.position)}</dd>
                <dt>Full extents</dt><dd>{coordinates(object.dimensions)}</dd>
                <dt>Color</dt><dd>{object.color}</dd><dt>Tags</dt><dd>{object.tags.join(", ")}</dd>
              </dl>
            </div>)}
        </section>}
      </section>
      <section className="scene-column" aria-label="3D workspace">
        {scene ? <Viewport scene={scene} selectedIds={selectedIds} filterIds={filtered} ghosts={ghosts} onSelect={select} />
          : <p className="loading scene-loading">Loading scene...</p>}
      </section>
      <aside className="chat-column" aria-label="Agent conversation">
        {hydrated ? <CopilotChat className="assistant-chat"
          input={{ className: "assistant-input", addMenuButton: NoAddMenu, showDisclaimer: false, sendButton: { "aria-label": agent.isRunning ? "Stop generating" : "Send message" } }}
          welcomeScreen={false}
        /> : <p className="loading">Loading conversation...</p>}
      </aside>
    </main>
  </>;
}

export function App() {
  const [thread, setThread] = useState(() => {
    const saved = sessionStorage.getItem("agent3d.thread");
    return { id: saved ?? crypto.randomUUID(), reconnect: !!saved };
  });
  const threadId = thread.id;
  const [error, setError] = useState("");
  useEffect(() => { sessionStorage.setItem("agent3d.thread", threadId); }, [threadId]);
  return <CopilotKitProvider key={threadId} runtimeUrl="/api/copilotkit" enableInspector={false}
    messageFilter={lastUserMessage} onError={({ error }) => setError(error.message)}>
    <CopilotChatConfigurationProvider agentId="default" threadId={threadId} hasExplicitThreadId={false}>
      <SceneWorkspace threadId={threadId} reconnect={thread.reconnect}
        newScene={() => { setError(""); setThread({ id: crypto.randomUUID(), reconnect: false }); }} error={error} onError={setError} />
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>;
}
