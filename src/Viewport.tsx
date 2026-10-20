import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { SceneObject, SceneSnapshot } from "./scene";

export function fitDistance(diameter: number, aspect: number, fov: number) {
  const halfAngle = Math.atan(Math.tan(fov * Math.PI / 360) * Math.min(aspect, 1));
  return diameter / (2 * Math.sin(halfAngle)) * 1.1;
}

export function Viewport({ scene, selectedIds, filterIds, ghosts, onSelect }: {
  scene: SceneSnapshot;
  selectedIds: string[];
  filterIds: string[];
  ghosts: SceneObject[];
  onSelect: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const fit = useRef<() => void>(() => {});
  const updateScene = useRef<(scene: SceneSnapshot, selectedIds: string[], filterIds: string[], ghosts: SceneObject[]) => void>(() => {});
  const onSelectRef = useRef(onSelect);
  const [error, setError] = useState("");
  onSelectRef.current = onSelect;

  useEffect(() => {
    const element = container.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError("WebGL is unavailable. Use the object list and property inspector below.");
      return;
    }
    setError("");
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute("aria-label", "3D scene");
    renderer.domElement.setAttribute("role", "img");
    element.appendChild(renderer.domElement);
    const world = new THREE.Scene();
    world.background = new THREE.Color("#edf0f3");
    world.add(new THREE.HemisphereLight(0xffffff, 0x607080, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(8, 16, 12);
    world.add(light);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const content = new THREE.Group();
    world.add(content);
    const meshes: THREE.Mesh[] = [];
    const center = new THREE.Vector3();
    let size = 0;
    let needsInitialFit = true;
    fit.current = () => {
      if (!size || !element.clientWidth || !element.clientHeight) return;
      camera.aspect = element.clientWidth / element.clientHeight;
      const distance = fitDistance(size, camera.aspect, camera.fov);
      controls.target.copy(center);
      camera.position.copy(center).add(new THREE.Vector3(1, 0.8, 1.3).normalize().multiplyScalar(distance));
      camera.near = Math.max(0.01, size / 1000);
      camera.far = Math.max(100, distance + size * 2);
      camera.updateProjectionMatrix();
      controls.update();
      needsInitialFit = false;
    };
    function clearContent() {
      content.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      content.clear();
      meshes.length = 0;
    }
    updateScene.current = (snapshot, selection, filter, proposals) => {
      clearContent();
      const selected = new Set(selection);
      const highlighted = new Set([...snapshot.highlightedIds, ...filter]);
      function meshFor(object: SceneObject, ghost = false) {
        const { x, y, z } = object.dimensions;
        const geometry = object.shape === "box" ? new THREE.BoxGeometry(x, y, z)
          : object.shape === "sphere" ? new THREE.SphereGeometry(x / 2, 24, 16)
            : new THREE.CylinderGeometry(x / 2, x / 2, y, 24);
        const material = new THREE.MeshStandardMaterial({
          color: object.color, roughness: 0.55, transparent: ghost, opacity: ghost ? 0.32 : 1,
          depthWrite: !ghost, wireframe: ghost,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(object.position.x, object.position.y, object.position.z);
        mesh.userData.objectId = object.id;
        content.add(mesh);
        if (!ghost) {
          meshes.push(mesh);
          if (selected.has(object.id) || highlighted.has(object.id)) {
            content.add(new THREE.BoxHelper(mesh, selected.has(object.id) ? 0x2459d3 : 0x7851b1));
          }
        }
      }
      snapshot.objects.forEach((object) => meshFor(object));
      proposals.forEach((object) => meshFor(object, true));
      const bounds = new THREE.Box3();
      meshes.forEach((mesh) => bounds.expandByObject(mesh));
      bounds.getCenter(center);
      size = bounds.getSize(new THREE.Vector3()).length();
      const grid = new THREE.GridHelper(Math.max(20, size * 1.5), 20, 0xb8c3cf, 0xd5dce4);
      grid.position.set(center.x, bounds.min.y - 0.02, center.z);
      content.add(grid);
      camera.far = Math.max(100, camera.position.distanceTo(center) + size * 2);
      camera.updateProjectionMatrix();
      if (needsInitialFit) fit.current();
    };
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      if (needsInitialFit) fit.current();
      else camera.updateProjectionMatrix();
    });
    observer.observe(element);
    let down = { x: 0, y: 0 };
    const pointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
    const pointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const point = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(point, camera);
      const hit = ray.intersectObjects(meshes)[0];
      if (hit) onSelectRef.current(String(hit.object.userData.objectId));
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(world, camera); });
    return () => {
      updateScene.current = () => {};
      fit.current = () => {};
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      clearContent();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    updateScene.current(scene, selectedIds, filterIds, ghosts);
  }, [scene, selectedIds, filterIds, ghosts]);

  return <section className="viewport-panel" aria-label="Scene viewport">
    <div ref={container} className="viewport" />
    {error && <p role="status" className="fallback">{error}</p>}
    <button className="fit-button" onClick={() => fit.current()}>Fit scene</button>
  </section>;
}
