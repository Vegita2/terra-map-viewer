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

export function loadMap(map: GameMap) {
	console.log(map);
}
