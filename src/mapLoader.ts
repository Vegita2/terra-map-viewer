import * as THREE from 'three';
import { scene } from './main';
import type { GameMap, HeightMap, Vec3 } from './types';
import uvTextureUrl from '../uv.png';

// Single shared debug atlas (uv.png is a 16×16 grid of 24×16 px cells, see
// gen_uv_debug.py). NearestFilter keeps the grid/labels crisp; flipY=false so
// UV (0,0) is the image's top-left, matching the engine's texX/texY-from-top
// atlas convention (MAP_FORMAT.md → "How tile textures are projected").
const tileTexture = new THREE.TextureLoader().load(uvTextureUrl);
tileTexture.colorSpace = THREE.SRGBColorSpace;
tileTexture.magFilter = THREE.NearestFilter;
tileTexture.flipY = false;

// One unlit material shared by every layer mesh — it's never mutated per mesh,
// so a single instance is enough (disposeGroup leaves it alone).
const tileMaterial = new THREE.MeshBasicMaterial({ map: tileTexture });

// Atlas layout of uv.png: 384×256 px / (24×16 px per tile) = 16×16 cells.
const ATLAS_COLS = 16;
const ATLAS_ROWS = 16;

// zData bit layout (Z_DATA_FLAGS in bundle.js): bits 0-5 = Z_TOP (local height
// in tile-widths), bits 6-8 = SHAPE (0 = full square, 1-4 = half-tile cut).
const HEIGHT_MASK = 0x3f;
const heightAt = (hm: HeightMap, x: number, y: number) =>
	hm.zData[y * hm.size[0] + x] & HEIGHT_MASK;
const shapeAt = (hm: HeightMap, x: number, y: number) =>
	(hm.zData[y * hm.size[0] + x] >>> 6) & 7;

// SHAPE 1-4 cut the tile diagonally; SHAPE_TIP names the surviving (right-
// angle) corner. The floor stays a full square either way — but the two
// cardinal sides on the cut half are skipped, and a diagonal wall along the
// hypotenuse covers that corner instead.
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

interface MeshBuf {
	positions: number[];
	uvs: number[];
	indices: number[];
}

// An atlas cell as [u0, v0, u1, v1] (u0,v0 = the cell's top-left in the image).
type UVRect = [number, number, number, number];
// The four corner UVs for one quad, in a→b→c→d vertex order (8 numbers).
type UVQuad = [number, number, number, number, number, number, number, number];

// Floor and wall quads wind their corners through different world axes, so each
// needs its own cell-corner layout to show the texture the same way up. Both
// keep it upright and un-mirrored (cell top-left = the label/dot corner).

// Floor quad corners are passed NW, SW, SE, NE → TL, BL, BR, TR.
function floorUV([u0, v0, u1, v1]: UVRect): UVQuad {
	return [u0, v0, u0, v1, u1, v1, u1, v0];
}
// Wall quad corners are passed A-top, B-top, B-bottom, A-bottom → TR, TL, BL, BR,
// so the cell's top sits at the top of the wall and U runs along its length
// (mirrored from A→B so the texture reads the same way round as on the floor).
function wallUV([u0, v0, u1, v1]: UVRect): UVQuad {
	return [u1, v0, u0, v0, u0, v1, u1, v1];
}
// Diagonal-wall variant: skew the layout into a parallelogram so the texture
// slants down a tile across the hypotenuse. `dropA` chooses which end falls,
// so every diagonal can slant toward the same (southern) end regardless of tip.
function diagWallUV([u0, v0, u1, v1]: UVRect, dropA: boolean): UVQuad {
	const d = v1 - v0; // shift one cell down
	return dropA
		? [u1, v0 + d, u0, v0, u0, v1, u1, v1 + d]
		: [u1, v0, u0, v0 + d, u0, v1 + d, u1, v1];
}

function pushQuad(out: MeshBuf, a: Vec3, b: Vec3, c: Vec3, d: Vec3, uv: UVQuad) {
	const base = out.positions.length / 3;
	out.positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
	out.uvs.push(uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[6], uv[7]);
	out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// Stack one textured quad per height unit from `top` down to `floor`, so the
// tile repeats up the wall instead of being stretched across the whole span.
// A=(ax,az), B=(bx,bz) are the wall's two vertical edges; winding A→B matches
// pushQuad's a→b→c→d, so the face points the same way.
function addWallColumn(
	out: MeshBuf,
	ax: number, az: number, bx: number, bz: number,
	top: number, floor: number, q: UVQuad,
) {
	for (let hi = top; hi > floor; hi--) {
		pushQuad(out,
			[ax, hi, az], [bx, hi, bz], [bx, hi - 1, bz], [ax, hi - 1, az], q);
	}
}

// Decode a tile's atlas cell into a 24×16 px UV rect. tiles[i] packs the tile
// id in bits 5-16 (TILE_FLAGS); negative values are wall back-refs — fall back
// to cell 0 for now since those tops come from walls[], not a plain tile id.
function tileCellUV(hm: HeightMap, x: number, y: number): UVRect {
	const val = hm.tiles[y * hm.size[0] + x] ?? 0;
	const tileId = val >= 0 ? (val >>> 5) & 0xfff : 0;
	const idx = tileId % (ATLAS_COLS * ATLAS_ROWS);
	const cx = idx % ATLAS_COLS;
	const cy = Math.floor(idx / ATLAS_COLS);
	return [cx / ATLAS_COLS, cy / ATLAS_ROWS, (cx + 1) / ATLAS_COLS, (cy + 1) / ATLAS_ROWS];
}

// A heightmap layer plus its world origin, threaded through the generators.
// Three.js coords: game x → world x, game height → world y, game y → world z.
interface Layer {
	hm: HeightMap;
	px: number;
	py: number;
	pz: number;
	w: number;
	h: number;
}

// World-space top height (y) of a tile. Off-edge tiles report one unit below
// the layer floor so border cliffs still get a visible foot to draw down to.
function topAt(layer: Layer, x: number, y: number): number {
	const { hm, pz, w, h } = layer;
	if (x < 0 || y < 0 || x >= w || y >= h) return pz - 1;
	return pz + heightAt(hm, x, y);
}

// A full-square floor quad for tile (x,y) at world height `h`. CCW from +Y so
// the normal points up. Floors are always full quads (SHAPE is ignored here).
function addFloorQuad(out: MeshBuf, layer: Layer, x: number, y: number, h: number) {
	const x0 = layer.px + x, x1 = x0 + 1;
	const z0 = layer.py + y, z1 = z0 + 1;
	pushQuad(out,
		[x0, h, z0], [x0, h, z1], [x1, h, z1], [x1, h, z0],
		floorUV(tileCellUV(layer.hm, x, y)));
}

// The flat top of a tile, at its own height.
function addFloorTile(out: MeshBuf, layer: Layer, x: number, y: number) {
	addFloorQuad(out, layer, x, y, topAt(layer, x, y));
}

// One cardinal cliff side: dx/dy points at the neighbor whose height is the
// wall's foot; (ax,az)→(bx,bz) is the tile edge it stands on, as 0/1 corner
// offsets wound so the face points outward.
interface Cardinal {
	side: 'N' | 'E' | 'S' | 'W';
	dx: number; dy: number;
	ax: number; az: number; bx: number; bz: number;
}
const CARDINALS: Cardinal[] = [
	{ side: 'N', dx: 0, dy: -1, ax: 0, az: 0, bx: 1, bz: 0 },
	{ side: 'S', dx: 0, dy: 1, ax: 1, az: 1, bx: 0, bz: 1 },
	{ side: 'W', dx: -1, dy: 0, ax: 0, az: 1, bx: 0, bz: 0 },
	{ side: 'E', dx: 1, dy: 0, ax: 1, az: 0, bx: 1, bz: 1 },
];

// Vertical cliff faces — one per cardinal side wherever the neighbor is lower.
// Sides cut away by a diagonal SHAPE are skipped (the diagonal wall covers them).
function addCardinalWalls(out: MeshBuf, layer: Layer, x: number, y: number) {
	const top = topAt(layer, x, y);
	const shape = shapeAt(layer.hm, x, y);
	const uv = tileCellUV(layer.hm, x, y);
	for (const c of CARDINALS) {
		const floor = topAt(layer, x + c.dx, y + c.dy);
		if (floor >= top || isSideCut(shape, c.side)) continue;
		const ax = layer.px + x + c.ax, az = layer.py + y + c.az;
		const bx = layer.px + x + c.bx, bz = layer.py + y + c.bz;
		addWallColumn(out, ax, az, bx, bz, top, floor, wallUV(uv));
	}
}

// The diagonal hypotenuse wall on a diagonally-cut tile: a vertical quad (no
// z-tilt) from the two hypotenuse endpoints (va, vb) down to the lower floor.
function addDiagonalWall(out: MeshBuf, layer: Layer, x: number, y: number) {
	const tip = SHAPE_TIP[shapeAt(layer.hm, x, y)];
	if (!tip) return;
	const top = topAt(layer, x, y);
	const x0 = layer.px + x, x1 = x0 + 1;
	const z0 = layer.py + y, z1 = z0 + 1;
	const nh = topAt(layer, x, y - 1), sh = topAt(layer, x, y + 1);
	const wh = topAt(layer, x - 1, y), eh = topAt(layer, x + 1, y);
	const uv = tileCellUV(layer.hm, x, y);

	// va/vb are the two hypotenuse endpoints in XZ.
	let floor: number, vax: number, vaz: number, vbx: number, vbz: number;
	switch (tip) {
		case 'NW': floor = Math.min(sh, eh); vax = x0; vaz = z1; vbx = x1; vbz = z0; break;
		case 'NE': floor = Math.min(sh, wh); vax = x0; vaz = z0; vbx = x1; vbz = z1; break;
		case 'SE': floor = Math.min(nh, wh); vax = x1; vaz = z0; vbx = x0; vbz = z1; break;
		case 'SW': floor = Math.min(nh, eh); vax = x1; vaz = z1; vbx = x0; vbz = z0; break;
	}
	// The diagonal faces opposite a cardinal edge, so feed the endpoints to
	// addWallColumn in vb→va order to flip the winding outward. The sheared UVs
	// (diagWallUV) always slant down toward the southern (larger-z) endpoint, so
	// every diagonal descends the same way rather than half going up.
	addWallColumn(out, vbx, vbz, vax, vaz, top, floor, diagWallUV(uv, vbz > vaz));

	// Floors are full quads, so give the wall's foot a floor tile at the lower
	// level it drops into (fills the cut-away corner the diagonal carves out).
	addFloorQuad(out, layer, x, y, floor);
}

function buildLayerMesh(hm: HeightMap): THREE.Mesh {
	const [px, py, pz] = hm.pos;
	const [w, h] = hm.size;
	const layer: Layer = { hm, px, py, pz, w, h };
	const out: MeshBuf = { positions: [], uvs: [], indices: [] };

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			addFloorTile(out, layer, x, y);
			addCardinalWalls(out, layer, x, y);
			addDiagonalWall(out, layer, x, y);
		}
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(out.positions, 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(out.uvs, 2));
	geo.setIndex(out.indices);
	return new THREE.Mesh(geo, tileMaterial);
}

function disposeGroup(group: THREE.Group) {
	for (const child of group.children) {
		if (child instanceof THREE.Mesh) {
			// Geometry is per-mesh; the material (tileMaterial) is shared and reused.
			child.geometry.dispose();
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
		group.add(buildLayerMesh(map.heightMaps[i]));
	}
	currentMap = group;
	scene.add(group);
}
