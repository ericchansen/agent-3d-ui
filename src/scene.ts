import Ajv from "ajv";
import schema from "../contracts/application.schema.json";

export interface Vector { x: number; y: number; z: number }
export interface SceneObject {
  id: string;
  name: string;
  shape: "box" | "sphere" | "cylinder";
  position: Vector;
  dimensions: Vector;
  color: string;
  tags: string[];
}
export interface SceneSnapshot {
  schemaVersion: 1;
  revision: number;
  objects: SceneObject[];
  selectedIds: string[];
  highlightedIds: string[];
}
export interface EditRequest {
  ids: string[];
  expectedRevision: number;
  edit: { color?: string | null; position?: Vector | null };
}
export interface AgentState {
  scene: SceneSnapshot;
  receipt?: {
    operationId: string;
    affectedIds: string[];
    oldRevision: number;
    newRevision: number;
    outcome: "committed" | "rejected" | "cancelled" | "stale";
  } | null;
  error?: { code: string; message: string; retryable: boolean; correlationId: string } | null;
  provider?: { name: string; model: string };
  traceId?: string | null;
  [key: string]: unknown;
}

const ajv = new Ajv({ strict: true, strictNumbers: true });
ajv.addSchema(schema);
const stateSchema = ajv.compile<AgentState>({ $ref: schema.$id });
const editSchema = ajv.compile<EditRequest>({ $ref: `${schema.$id}#/$defs/EditRequest` });

export function readState(value: unknown): AgentState {
  if (!stateSchema(value)) throw new Error(`Invalid scene state: ${ajv.errorsText(stateSchema.errors)}`);
  const scene = value.scene;
  const ids = new Set(scene.objects.map((object) => object.id));
  if (ids.size !== scene.objects.length) throw new Error("Scene contains duplicate object ids.");
  if ([...scene.selectedIds, ...scene.highlightedIds].some((id) => !ids.has(id))) {
    throw new Error("Scene selection or highlight references a missing object.");
  }
  for (const object of scene.objects) {
    const { x, y, z } = object.dimensions;
    if ((object.shape === "sphere" && (x !== y || x !== z)) ||
        (object.shape === "cylinder" && x !== z)) {
      throw new Error(`Invalid full extents for ${object.id}.`);
    }
  }
  const receipt = value.receipt;
  if (receipt && (receipt.newRevision !== receipt.oldRevision + (receipt.outcome === "committed" ? 1 : 0) ||
      receipt.newRevision > scene.revision ||
      receipt.affectedIds.some((id) => !ids.has(id)))) {
    throw new Error("Receipt is inconsistent with the authoritative scene.");
  }
  return value;
}

export function previewEdit(scene: SceneSnapshot, value: unknown) {
  if (!editSchema(value)) throw new Error(`Invalid edit: ${ajv.errorsText(editSchema.errors)}`);
  if (value.expectedRevision !== scene.revision) throw new Error("Scene changed. Reject this edit and prepare a new request.");
  return value.ids.map((id) => {
    const before = scene.objects.find((object) => object.id === id);
    if (!before) throw new Error(`Edit references missing object ${id}.`);
    return { before, after: { ...before, color: value.edit.color ?? before.color, position: value.edit.position ?? before.position } };
  });
}

export function matchingIds(scene: SceneSnapshot, filter: string): string[] {
  const words = filter.toLowerCase().trim().split(/\s+/);
  return scene.objects.filter((object) => {
    const text = [object.id, object.name, object.shape, object.color, ...object.tags].join(" ").toLowerCase();
    return words.every((word) => text.includes(word));
  }).map((object) => object.id);
}
