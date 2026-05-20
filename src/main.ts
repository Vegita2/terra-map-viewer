import * as THREE from 'three';
import { CameraController } from './CameraController';
import { setupFolderPicker } from './FolderPicker';

setupFolderPicker();

export const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
	75,
	window.innerWidth / window.innerHeight,
	0.1,
	1000,
);
// Position above and south of the map area, angled down toward the origin
// so the floor plane and axis gizmo are visible at startup. The controller
// reads the camera's quaternion in its constructor, so lookAt happens first.
camera.position.set(15, 25, 40);
camera.lookAt(15, 0, 15);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

const controls = new CameraController(camera, renderer.domElement);

// Lighting: ambient base + a key directional from above-front so cliff
// sides catch a different intensity than flat tops and elevation reads.
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(1, 1.5, 0.6);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x99aaff, 0.25);
fillLight.position.set(-1, 0.5, -0.6);
scene.add(fillLight);

// Origin axis gizmo — red = +X, green = +Y, blue = +Z (Unity/Godot style).
const origin = new THREE.Vector3(0, 0, 0);
const AXIS_LENGTH = 3;
const HEAD_LENGTH = 1;
const HEAD_WIDTH = 0.5;
scene.add(
	new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), origin, AXIS_LENGTH, 0xff3333, HEAD_LENGTH, HEAD_WIDTH),
	new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), origin, AXIS_LENGTH, 0x33ff33, HEAD_LENGTH, HEAD_WIDTH),
	new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), origin, AXIS_LENGTH, 0x3399ff, HEAD_LENGTH, HEAD_WIDTH),
);

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
	const delta = clock.getDelta();
	controls.update(delta);
	renderer.render(scene, camera);
});
