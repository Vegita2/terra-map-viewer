import * as THREE from 'three';
import { scene } from './main';
import type { GameMap, HeightMap, Vec3 } from './types';

// zData bit layout (Z_DATA_FLAGS in bundle.js): bits 0-5 = Z_TOP (local height
// in tile-widths), bits 6-8 = SHAPE (0 = full square, 1-4 = half-tile cut).
const HEIGHT_MASK = 0x3f;
const heightAt = (hm: HeightMap, x: number, y: number) =>
	hm.zData[y * hm.size[0] + x] & HEIGHT_MASK;
const shapeAt = (hm: HeightMap, x: number, y: number) =>
	(hm.zData[y * hm.size[0] + x] >>> 6) & 7;

// SHAPE 1-4 cut the tile diagonally; SHAPE_TIP names the surviving (right-
// angle) corner. The two cardinal sides on the cut half are skipped — a
// diagonal hypotenuse wall covers them instead.
type Tip = 'NW' | 'NE' | 'SW' | 'SE';
const SHAPE_TIP: (Tip | null)[] = [null, 'SW', 'NW', 'NE', 'SE'];

function isSideCut(shape: number, side: 'N' | 'E' | 'S' | 'W'): boolean {
	switch (SHAPE_TIP[shape]) {
		case 'NE': return side === 'S' || side === 'W';
		case 'SE': return side === 'N' || side === 'W';
		case 'SW': return side === 'N' || side === 'E';
		case 'NW': return side === 'S' || side === 'E';
	}
	return false;
}

// CCW (viewed from +Y) so computeVertexNormals points the top normal up.
// SHAPE 0 → 4-vert unit square; SHAPE 1-4 → 3-vert right triangle.
function topPolygon(
	x0: number, x1: number, z0: number, z1: number, h: number, shape: number,
): Vec3[] {
	const NW: Vec3 = [x0, h, z0];
	const SW: Vec3 = [x0, h, z1];
	const SE: Vec3 = [x1, h, z1];
	const NE: Vec3 = [x1, h, z0];
	switch (SHAPE_TIP[shape]) {
		case 'NE': return [NW, SE, NE];  // cut SW
		case 'SE': return [SW, SE, NE];  // cut NW
		case 'SW': return [NW, SW, SE];  // cut NE
		case 'NW': return [NW, SW, NE];  // cut SE
	}
	return [NW, SW, SE, NE];
}

interface MeshBuf {
	positions: number[];
	colors: number[];
	indices: number[];
}

function pushQuad(out: MeshBuf, a: Vec3, b: Vec3, c: Vec3, d: Vec3, col: Vec3) {
	const base = out.positions.length / 3;
	out.positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
	for (let i = 0; i < 4; i++) out.colors.push(col[0], col[1], col[2]);
	out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function pushPolygon(out: MeshBuf, verts: Vec3[], col: Vec3) {
	if (verts.length < 3) return;
	const base = out.positions.length / 3;
	for (const v of verts) {
		out.positions.push(v[0], v[1], v[2]);
		out.colors.push(col[0], col[1], col[2]);
	}
	for (let i = 1; i < verts.length - 1; i++) {
		out.indices.push(base, base + i, base + i + 1);
	}
}

// Distinct per-layer tint so stacked slabs read separately under the lights.
const LAYER_COLORS: Vec3[] = [
	[0.28, 0.52, 0.72],
	[0.82, 0.55, 0.38],
	[0.70, 0.70, 0.78],
	[0.55, 0.70, 0.45],
	[0.78, 0.62, 0.78],
	[0.85, 0.78, 0.50],
	[0.55, 0.78, 0.78],
];

function buildLayerMesh(hm: HeightMap, layerIdx: number): THREE.Mesh {
	const [px, py, pz] = hm.pos;
	const [w, h] = hm.size;
	const base = LAYER_COLORS[layerIdx % LAYER_COLORS.length];
	const out: MeshBuf = { positions: [], colors: [], indices: [] };

	// Off-edge cliffs drop one unit below the layer so they have a visible foot.
	const baseFloor = pz - 1;
	const nbH = (xx: number, yy: number) => {
		if (xx < 0 || yy < 0 || xx >= w || yy >= h) return baseFloor;
		return pz + heightAt(hm, xx, yy);
	};

	// Three.js coords here: game x → world x, game height → world y,
	// game y → world z. Matches the floor-plane orientation in loadMap above.
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const hCell = pz + heightAt(hm, x, y);
			const shape = shapeAt(hm, x, y);
			const x0 = px + x, x1 = px + x + 1;
			const z0 = py + y, z1 = py + y + 1;

			// Brightness modulation by absolute height so taller cells read lighter.
			const t = Math.min(1, Math.max(0, (hCell - pz) / 8));
			const top: Vec3 = [
				Math.min(1, base[0] * (0.75 + 0.4 * t)),
				Math.min(1, base[1] * (0.75 + 0.4 * t)),
				Math.min(1, base[2] * (0.75 + 0.4 * t)),
			];
			const side: Vec3 = [top[0] * 0.65, top[1] * 0.65, top[2] * 0.65];

			// Top face.
			pushPolygon(out, topPolygon(x0, x1, z0, z1, hCell, shape), top);

			// Cardinal cliff walls — emit one wherever a neighbor is lower.
			const nh = nbH(x, y - 1);
			const sh = nbH(x, y + 1);
			const wh = nbH(x - 1, y);
			const eh = nbH(x + 1, y);
			if (nh < hCell && !isSideCut(shape, 'N')) {
				pushQuad(out,
					[x0, hCell, z0], [x1, hCell, z0],
					[x1, nh, z0], [x0, nh, z0], side);
			}
			if (sh < hCell && !isSideCut(shape, 'S')) {
				pushQuad(out,
					[x1, hCell, z1], [x0, hCell, z1],
					[x0, sh, z1], [x1, sh, z1], side);
			}
			if (wh < hCell && !isSideCut(shape, 'W')) {
				pushQuad(out,
					[x0, hCell, z1], [x0, hCell, z0],
					[x0, wh, z0], [x0, wh, z1], side);
			}
			if (eh < hCell && !isSideCut(shape, 'E')) {
				pushQuad(out,
					[x1, hCell, z0], [x1, hCell, z1],
					[x1, eh, z1], [x1, eh, z0], side);
			}

			// Diagonal hypotenuse wall — engine's WALL_SE convention: top edge
			// slants from the high corner at hCell to the low corner one
			// tile-step below, bottom edge parallels it (parallelogram tilted
			// in z). va = high corner, vb = low corner.
			const tip = SHAPE_TIP[shape];
			if (tip) {
				let dFloor: number, va: Vec3, vb: Vec3;
				switch (tip) {
					case 'NW': dFloor = Math.min(sh, eh); va = [x0, hCell, z1]; vb = [x1, hCell, z0]; break;
					case 'NE': dFloor = Math.min(sh, wh); va = [x0, hCell, z0]; vb = [x1, hCell, z1]; break;
					case 'SE': dFloor = Math.min(nh, wh); va = [x1, hCell, z0]; vb = [x0, hCell, z1]; break;
					case 'SW': dFloor = Math.min(nh, eh); va = [x1, hCell, z1]; vb = [x0, hCell, z0]; break;
				}
				if (dFloor < hCell) {
					pushQuad(out,
						va,
						[va[0], dFloor, va[2]],
						[vb[0], dFloor - 1, vb[2]],
						[vb[0], hCell - 1, vb[2]],
						side);
				}
			}
		}
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(out.positions, 3));
	geo.setAttribute('color', new THREE.Float32BufferAttribute(out.colors, 3));
	geo.setIndex(out.indices);
	geo.computeVertexNormals();
	const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
	return new THREE.Mesh(geo, mat);
}

function disposeGroup(group: THREE.Group) {
	for (const child of group.children) {
		if (child instanceof THREE.Mesh) {
			child.geometry.dispose();
			(child.material as THREE.Material).dispose();
		}
	}
}

let currentMap: THREE.Group | null = null;

export function loadMap(map: GameMap) {
	console.log(map);
	if (currentMap) {
		scene.remove(currentMap);
		disposeGroup(currentMap);
	}

	const group = new THREE.Group();
	for (let i = 0; i < map.heightMaps.length; i++) {
		group.add(buildLayerMesh(map.heightMaps[i], i));
	}
	currentMap = group;
	scene.add(group);
}
