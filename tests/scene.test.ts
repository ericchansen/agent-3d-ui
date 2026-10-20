import { describe, expect, it } from "vitest";
import seed from "../contracts/fixtures/seed.scene.json";
import move from "../contracts/fixtures/move.request.json";
import { matchingIds, previewEdit, readState } from "../src/scene";
import { fitDistance } from "../src/Viewport";
import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from "three";

it.each([0.4, 1, 2])("fits the complete scene bounds at viewport aspect %s", (aspect) => {
  const camera = new PerspectiveCamera(45, aspect, 0.1, 1000);
  camera.position.z = fitDistance(20, aspect, camera.fov);
  camera.updateMatrixWorld();
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  expect(frustum.planes.every((plane) => plane.distanceToPoint(new Vector3()) >= 10)).toBe(true);
});

describe("authoritative scene and projected edits", () => {
  it("projects exact coordinates without mutating the seed or accepting stale edits", () => {
    const scene = readState({ scene: structuredClone(seed), todos: [] }).scene;
    const preview = previewEdit(scene, move);
    expect(preview[0].after.position.y).toBe(3);
    expect(scene.objects[0].position.y).toBe(1);
    expect(scene.revision).toBe(0);
    expect(() => previewEdit(scene, { ...move, expectedRevision: 1 })).toThrow("Scene changed");
    expect(matchingIds(scene, "blue cylinder")).toEqual(["cylinder-01", "cylinder-02"]);
  });

  it.each([
    { edit: {} },
    { edit: { color: null, position: null } },
    { edit: { color: "#FFF" } },
    { edit: { position: { x: 0, y: Infinity, z: 0 } } },
    { edit: { position: { x: 0, y: 1001, z: 0 } } },
    { edit: { dimensions: { x: 1, y: 1, z: 1 } } },
    { ids: ["missing"] },
    { ids: ["box-01", "box-01"] },
    { ids: Array.from({ length: 17 }, (_, i) => `box-${i}`) },
  ])("rejects unsafe preview input %j", (change) => {
    expect(() => previewEdit(readState({ scene: seed }).scene, { ...move, ...change })).toThrow();
  });

  it("rejects invalid scene references and non-spherical extents", () => {
    const scene = readState({ scene: structuredClone(seed) }).scene;
    scene.selectedIds = ["missing"];
    expect(() => readState({ scene })).toThrow("missing object");
    scene.selectedIds = [];
    scene.objects[4].dimensions.x = 9;
    expect(() => readState({ scene })).toThrow("full extents");
  });

  it("projects native null optional fields as unchanged without rewriting approved args", () => {
    const args = { ...move, edit: { color: "#16A34A", position: null } };
    const changes = previewEdit(readState({ scene: seed }).scene, args);
    expect(changes[0].after.color).toBe("#16A34A");
    expect(changes[0].after.position).toEqual(seed.objects[0].position);
    expect(args.edit.position).toBeNull();
  });

  it("rejects a receipt that reports an impossible revision", () => {
    expect(() => readState({ scene: seed, receipt: {
      operationId: "call-1", affectedIds: ["box-01"], oldRevision: 0, newRevision: 0, outcome: "committed",
    } })).toThrow("Receipt");
  });
});
