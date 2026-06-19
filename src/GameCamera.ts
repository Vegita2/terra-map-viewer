import * as THREE from 'three';

/**
 * Reproduces Alabaster Dawn's in-game map camera — the engine class
 * `TriPerspectiveGameView` in `game/terra/dist/bundle.js`.
 *
 * The signature "looks-like-SNES-but-is-real-3D" projection is a 25° vertical
 * perspective viewed down a 45° tilt, with a z→y shear baked into the view
 * matrix so the world's vertical (height) axis projects to a strictly vertical
 * line on screen. See `MAP_FORMAT.md` "How tile textures are projected".
 *
 * The view matrix the engine builds (gl-matrix, column-major, post-multiply) is
 *
 *   cameraM = T(0,0,-zDist)
 *           · Rx(-π·0.5·xRot)          // tilt, xRot=0.5 → -45°
 *           · Shear_zToY(skew)         // y' = y + skew·z, skew=0.45
 *           · S(TILE_W/TILE_H, -yScale, 1)
 *           · Rz(2π·zRotate)
 *           · T(-target)
 *
 * followed by a plain `perspective(fovRad, aspect, near, far)`. All numeric
 * constants below are copied verbatim from the engine's VIEW_CONF / MAP_CONF /
 * SYSTEM_CONF.
 *
 * NOTE: VIEW_CONF's module-level defaults (FOV 30, X_ROTATE 0.2, ...) are
 * overridden at startup in `main-config.js`. The values
 * below are those *runtime* values — the ones the shipped game actually uses.
 *
 * Coordinate note: the engine works in game space (x = east, y = south,
 * z = up/height). `mapLoader` places geometry in three.js space as
 * three(x, y, z) = game(x, height, y), so we right-multiply by THREE_TO_GAME
 * to map a three.js world point back into the frame the engine math expects.
 */

// VIEW_CONF runtime values (set in main-config.js, overriding the defaults).
const FIELD_OF_VIEW = 25; // degrees, vertical
const Z_NEAR = 10;
const Z_FAR = 150;
const X_ROTATE = 0.5; // tilt amount; actual angle = -π·0.5·X_ROTATE = -45°
const SKEW_FACTOR = 0.45; // z→y shear: y' = y + 0.45·z

// MAP_CONF. Tiles are 24×16 px, so x is stretched 24/16.
const TILE_W = 24;
const TILE_H = 16;

// SYSTEM_CONF.SCREEN_HEIGHT. The engine derives the camera
// distance from `canvasHeight / g_system.scale`, and integer pixel-scaling
// keeps that ratio pinned near the 360px base. Using the constant directly
// gives the exact game perspective convergence at any window size.
const SCREEN_HEIGHT = 360;

// three(x, y, z) -> game(x, y, z) = (x, z, y): swap three's y (up) and z.
// Its own inverse; defined once.
const THREE_TO_GAME = new THREE.Matrix4().set(
	1, 0, 0, 0,
	0, 0, 1, 0,
	0, 1, 0, 0,
	0, 0, 0, 1,
);

/** Write a gl-matrix-style perspective into a THREE.Matrix4 (WebGL clip, z∈[-1,1]). */
function setPerspective(
	out: THREE.Matrix4, fovyRad: number, aspect: number, near: number, far: number,
): void {
	const f = 1 / Math.tan(fovyRad / 2);
	const nf = 1 / (near - far);
	const e = out.elements; // column-major, matching gl-matrix
	e[0] = f / aspect; e[1] = 0; e[2] = 0; e[3] = 0;
	e[4] = 0; e[5] = f; e[6] = 0; e[7] = 0;
	e[8] = 0; e[9] = 0; e[10] = (far + near) * nf; e[11] = -1;
	e[12] = 0; e[13] = 0; e[14] = 2 * far * near * nf; e[15] = 0;
}

const DEFAULT_TARGET = new THREE.Vector3(15, 15, 0); // game coords (x, y, height)

/**
 * Game-style camera with drag/keyboard navigation.
 *
 * - WASD / arrows: pan the look-target across the ground (screen-relative)
 * - Left-drag: grab and pan the map
 * - Mouse wheel: zoom (>1 = zoomed in), like the in-game zoom levels
 * - Q / E: lower / raise the target height
 * - Z / X: rotate the camera around vertical (zRotate)
 * - R: reset target, zoom and rotation
 */
export class GameCameraController {
	/** The THREE camera the renderer should use while this controller is active. */
	readonly camera = new THREE.Camera();

	private readonly domElement: HTMLElement;

	/** Whether input is handled and matrices are refreshed. */
	enabled = false;

	// --- Engine projection parameters (faithful to TriPerspectiveGameView). ---
	fovDeg = FIELD_OF_VIEW;
	zNear = Z_NEAR;
	zFar = Z_FAR;
	/** View-level tilt amount (VIEW_CONF.X_ROTATE). Angle = -π·0.5·xRotate. */
	xRotate = X_ROTATE;
	/** z→y shear (VIEW_CONF.SKEW_FACTOR). */
	skewFactor = SKEW_FACTOR;

	// --- Controllable camera state (mirrors the engine's TriCamera). ---
	/** Look-target in game coords (x = east, y = south, z = height). */
	readonly target = DEFAULT_TARGET.clone();
	/** Zoom factor; >1 zooms in (divides camera distance, as the engine does). */
	zoom = 1;
	/** Camera rotation around vertical, in turns (0..1). */
	zRotate = 0;
	/**
	 * Per-camera tilt blend (the engine's `camera.xRotate`). 0 = the standard
	 * game tilt; 1 = fully top-down. Kept for fidelity with the engine formula.
	 */
	cameraXRotate = 0;

	// --- Control tuning. ---
	panSpeed = 10; // tiles/second at zoom 1
	sprintMultiplier = 4;
	heightSpeed = 6; // tiles/second
	rotateSpeed = 0.15; // turns/second
	minZoom = 0.1;
	maxZoom = 16;

	private width = 1;
	private height = 1;

	private readonly keys = new Set<string>();
	private dragging = false;

	// Scratch reused every frame to avoid per-frame allocation.
	private readonly view = new THREE.Matrix4();
	private readonly tmp = new THREE.Matrix4();

	private readonly onKeyDown = (e: KeyboardEvent) => {
		if (this.enabled) this.keys.add(e.code);
	};
	private readonly onKeyUp = (e: KeyboardEvent) => {
		this.keys.delete(e.code);
	};
	private readonly onMouseDown = (e: MouseEvent) => {
		if (this.enabled && e.button === 0) this.dragging = true;
	};
	private readonly onMouseUp = (e: MouseEvent) => {
		if (e.button === 0) this.dragging = false;
	};
	private readonly onMouseMove = (e: MouseEvent) => {
		if (!this.enabled || !this.dragging) return;
		// Grab-the-world panning: the point under the cursor stays under it.
		const tilesVisibleY = SCREEN_HEIGHT / (TILE_H * this.zoom);
		const worldPerPixelY = tilesVisibleY / this.height;
		const worldPerPixelX = worldPerPixelY * (TILE_H / TILE_W); // tiles are wider
		this.panGround(-e.movementX * worldPerPixelX, -e.movementY * worldPerPixelY);
	};
	private readonly onWheel = (e: WheelEvent) => {
		if (!this.enabled) return;
		e.preventDefault();
		this.zoom = THREE.MathUtils.clamp(
			this.zoom * Math.exp(-e.deltaY * 0.0015), this.minZoom, this.maxZoom,
		);
	};

	constructor(domElement: HTMLElement) {
		this.domElement = domElement;
		// We drive the camera matrices directly; keep three from overwriting them.
		this.camera.matrixAutoUpdate = false;

		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		domElement.addEventListener('mousedown', this.onMouseDown);
		window.addEventListener('mouseup', this.onMouseUp);
		window.addEventListener('mousemove', this.onMouseMove);
		domElement.addEventListener('wheel', this.onWheel, { passive: false });
	}

	/** Update the viewport size used for aspect ratio and drag math. */
	setSize(width: number, height: number): void {
		this.width = Math.max(1, width);
		this.height = Math.max(1, height);
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		if (!enabled) {
			this.keys.clear();
			this.dragging = false;
		}
	}

	/** Move the look-target across the ground plane, honoring camera rotation. */
	private panGround(dx: number, dy: number): void {
		const angle = 2 * Math.PI * this.zRotate;
		const c = Math.cos(angle), s = Math.sin(angle);
		this.target.x += dx * c - dy * s;
		this.target.y += dx * s + dy * c;
	}

	/** Advance from held keys, then rebuild the projection. Call once per frame. */
	update(deltaSeconds: number): void {
		if (this.enabled) this.handleKeys(deltaSeconds);
		this.rebuild();
	}

	private handleKeys(dt: number): void {
		const k = this.keys;
		const sprint = k.has('ShiftLeft') || k.has('ShiftRight') ? this.sprintMultiplier : 1;

		// Pan: screen-relative, constant on-screen speed regardless of zoom.
		let sx = 0, sy = 0;
		if (k.has('KeyW') || k.has('ArrowUp')) sy += 1;
		if (k.has('KeyS') || k.has('ArrowDown')) sy -= 1;
		if (k.has('KeyD') || k.has('ArrowRight')) sx += 1;
		if (k.has('KeyA') || k.has('ArrowLeft')) sx -= 1;
		if (sx !== 0 || sy !== 0) {
			const step = (this.panSpeed * sprint * dt) / this.zoom;
			const len = Math.hypot(sx, sy);
			// Screen up (+sy) = north = -game.y; screen right (+sx) = +game.x.
			this.panGround((sx / len) * step, -(sy / len) * step);
		}

		// Height (game z).
		if (k.has('KeyE')) this.target.z += this.heightSpeed * dt;
		if (k.has('KeyQ')) this.target.z -= this.heightSpeed * dt;

		// Rotate around vertical.
		if (k.has('KeyX')) this.zRotate += this.rotateSpeed * dt;
		if (k.has('KeyZ')) this.zRotate -= this.rotateSpeed * dt;

		if (k.has('KeyR')) {
			this.zoom = 1;
			this.zRotate = 0;
			this.cameraXRotate = 0;
		}
	}

	/** Rebuild the view + projection matrices, faithful to the engine update(). */
	private rebuild(): void {
		const fovRad = THREE.MathUtils.degToRad(this.fovDeg);
		const aspect = this.width / this.height;
		const srcZoom = Math.max(1e-4, this.zoom);

		// Engine's xRotateFactor / yScale / skew-mix (TriPerspectiveGameView).
		const xRotateFactor = THREE.MathUtils.clamp(1 - this.cameraXRotate, 0, 2);
		const xRot = this.xRotate * xRotateFactor;
		const yScale = xRotateFactor > 1
			? (2 - xRotateFactor) + (xRotateFactor - 1)
			: xRotateFactor + (TILE_W / TILE_H) * (1 - xRotateFactor);
		const skew = this.skewFactor * (xRotateFactor > 1 ? 2 - xRotateFactor : xRotateFactor);
		const zDist = SCREEN_HEIGHT / (2 * Math.tan(fovRad / 2) * TILE_H * srcZoom);

		// The engine ships a fixed near/far (0.1, 100) because it only ever zooms
		// IN (zDist <= base). We allow zooming out, which moves the camera back
		// (zDist = base / zoom), so we slide the depth window out by the same
		// factor. near/far affect only the depth buffer, never the framing, so at
		// zoom 1 this is identical to the engine; zoomed out, nothing clips.
		const nearEff = this.zNear / srcZoom;
		const farEff = this.zFar / srcZoom;

		const m = this.view.identity();
		m.multiply(this.tmp.makeTranslation(0, 0, -zDist));
		m.multiply(this.tmp.makeRotationX(-Math.PI * 0.5 * xRot));
		// Shear z→y: y' = y + skew·z (row-major .set).
		m.multiply(this.tmp.set(
			1, 0, 0, 0,
			0, 1, skew, 0,
			0, 0, 1, 0,
			0, 0, 0, 1,
		));
		m.multiply(this.tmp.makeScale(TILE_W / TILE_H, -yScale, 1));
		m.multiply(this.tmp.makeRotationZ(2 * Math.PI * this.zRotate));
		m.multiply(this.tmp.makeTranslation(-this.target.x, -this.target.y, -this.target.z));
		m.multiply(THREE_TO_GAME); // accept three.js world points

		// view = world->eye, so the camera's world transform is its inverse.
		const cam = this.camera;
		cam.matrixWorldInverse.copy(m);
		cam.matrixWorld.copy(m).invert();
		cam.matrix.copy(cam.matrixWorld);
		cam.matrixWorldNeedsUpdate = false;

		setPerspective(cam.projectionMatrix, fovRad, aspect, nearEff, farEff);
		cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
	}

	dispose(): void {
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		this.domElement.removeEventListener('mousedown', this.onMouseDown);
		window.removeEventListener('mouseup', this.onMouseUp);
		window.removeEventListener('mousemove', this.onMouseMove);
		this.domElement.removeEventListener('wheel', this.onWheel);
	}
}
