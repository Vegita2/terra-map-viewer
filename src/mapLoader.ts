import * as THREE from 'three';
import { scene } from './main';

type Vec2 = [number, number];
type Vec3 = [number, number, number];

type WallEntry = Array<number | WallEntry>;

interface HeightMap {
	pos: Vec3;
	size: Vec2;
	name?: string;
	noGen?: boolean;
	noGroundShadow?: boolean;
	noColl?: boolean;
	zData: number[];
	tiles: number[];
	walls: WallEntry[];
}

export interface GameMap {
	addons: unknown;
	entities: unknown;
	entityGroups: unknown;
	heightMaps: HeightMap[];
	parallax: unknown;
	planes: unknown;
	scenes: unknown;
	size: Vec2;
	sub: unknown;
	swaps: unknown;
	tags: unknown;
	tilesets: string[];
	topTiles: unknown;
	type: 'MAP';
	swapReverse?: boolean;
	vars: unknown;
}

let currentMap: THREE.Mesh | null = null;

export function loadMap(map: GameMap) {
	if (currentMap) {
		scene.remove(currentMap);
		currentMap.geometry.dispose();
		(currentMap.material as THREE.Material).dispose();
	}

	const [w, h] = map.size;
	const geometry = new THREE.PlaneGeometry(w, h);
	// PlaneGeometry stands on the XY plane by default; lay it flat (normal +Y)
	// and offset so the map's [0,0] corner sits at the world origin.
	geometry.rotateX(-Math.PI / 2);
	geometry.translate(w / 2, 0, h / 2);
	const material = new THREE.MeshBasicMaterial({
		color: 0x4a7a3a,
		side: THREE.DoubleSide,
	});
	currentMap = new THREE.Mesh(geometry, material);
	scene.add(currentMap);
}
