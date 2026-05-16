import * as THREE from 'three';

/**
 * Unity-style flythrough camera controls.
 *
 * - WASD: move forward/left/back/right (relative to where the camera looks)
 * - Q/E: move down/up (world axis)
 * - Shift: hold to move faster
 * - Right mouse button drag: look around
 */
export class CameraController {
	private readonly camera: THREE.PerspectiveCamera;
	private readonly domElement: HTMLElement;

	/** Base movement speed in units per second. */
	speed = 3;
	/** Multiplier applied while Shift is held. */
	sprintMultiplier = 4;
	/** Look sensitivity in radians per pixel of mouse movement. */
	lookSensitivity = 0.002;

	private readonly keys = new Set<string>();
	private looking = false;
	private yaw = 0;
	private pitch = 0;

	// Scratch objects reused every frame/event to avoid per-frame allocation.
	private readonly forward = new THREE.Vector3();
	private readonly right = new THREE.Vector3();
	private readonly up = new THREE.Vector3();
	private readonly move = new THREE.Vector3();
	private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

	private readonly onKeyDown = (e: KeyboardEvent) => {
		this.keys.add(e.code);
	};
	private readonly onKeyUp = (e: KeyboardEvent) => {
		this.keys.delete(e.code);
	};
	private readonly onMouseDown = (e: MouseEvent) => {
		if (e.button === 2) {
			this.looking = true;
		}
	};
	private readonly onMouseUp = (e: MouseEvent) => {
		if (e.button === 2) {
			this.looking = false;
		}
	};
	private readonly onMouseMove = (e: MouseEvent) => {
		if (!this.looking) return;
		this.yaw -= e.movementX * this.lookSensitivity;
		this.pitch -= e.movementY * this.lookSensitivity;
		// Clamp pitch to just under straight up/down to avoid flipping.
		const limit = Math.PI / 2 - 0.01;
		this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
		this.applyRotation();
	};
	private readonly onContextMenu = (e: Event) => {
		e.preventDefault();
	};

	constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
		this.camera = camera;
		this.domElement = domElement;

		// Seed yaw/pitch from the camera's current orientation.
		const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
		this.yaw = euler.y;
		this.pitch = euler.x;

		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		domElement.addEventListener('mousedown', this.onMouseDown);
		window.addEventListener('mouseup', this.onMouseUp);
		window.addEventListener('mousemove', this.onMouseMove);
		domElement.addEventListener('contextmenu', this.onContextMenu);
	}

	/** Advance the camera based on held keys. Call once per frame. */
	update(deltaSeconds: number): void {
		const k = this.keys;
		const moving =
			k.has('KeyW') || k.has('KeyS') || k.has('KeyA') ||
			k.has('KeyD') || k.has('KeyE') || k.has('KeyQ');
		if (!moving) return;

		const forward = this.camera.getWorldDirection(this.forward);
		const right = this.right.crossVectors(forward, this.camera.up).normalize();
		// Camera-local up, so Q/E move relative to where the camera is tilted.
		// right and forward are orthonormal, so their cross is already unit length.
		const up = this.up.crossVectors(right, forward);

		const move = this.move.set(0, 0, 0);
		if (k.has('KeyW')) move.add(forward);
		if (k.has('KeyS')) move.sub(forward);
		if (k.has('KeyD')) move.add(right);
		if (k.has('KeyA')) move.sub(right);
		if (k.has('KeyE')) move.add(up);
		if (k.has('KeyQ')) move.sub(up);
		if (move.lengthSq() === 0) return;

		const distance =
			this.speed *
			(k.has('ShiftLeft') || k.has('ShiftRight') ? this.sprintMultiplier : 1) *
			deltaSeconds;
		move.normalize().multiplyScalar(distance);
		this.camera.position.add(move);
	}

	private applyRotation(): void {
		this.euler.set(this.pitch, this.yaw, 0);
		this.camera.quaternion.setFromEuler(this.euler);
	}

	/** Remove all event listeners. */
	dispose(): void {
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		this.domElement.removeEventListener('mousedown', this.onMouseDown);
		window.removeEventListener('mouseup', this.onMouseUp);
		window.removeEventListener('mousemove', this.onMouseMove);
		this.domElement.removeEventListener('contextmenu', this.onContextMenu);
	}
}
