// Folder picker that persists the chosen directory handle in IndexedDB (via
// idb-keyval) so the same folder can be reused across page reloads.

import { get, set } from 'idb-keyval';
import { loadMap } from './mapLoader';

const HANDLE_KEY = 'folder';

// Subdirectory whose files are listed in the sidebar.
const MAPS_PATH = ['terra', 'data', 'maps'];

// Map auto-loaded on page load for quick testing (dotted path, no extension).
const AUTO_LOAD_MAP = '';

interface MapFile {
	path: string;
	handle: FileSystemFileHandle;
}

// Navigate from the chosen root down to the maps directory.
async function getMapsDir(
	root: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle> {
	let dir = root;
	for (const part of MAPS_PATH) {
		dir = await dir.getDirectoryHandle(part);
	}
	return dir;
}

// Recursively collect every file under a directory, with paths relative to it.
async function collectFiles(
	dir: FileSystemDirectoryHandle,
	prefix = '',
): Promise<MapFile[]> {
	const files: MapFile[] = [];
	for await (const [name, handle] of dir.entries()) {
		const path = prefix ? `${prefix}/${name}` : name;
		if (handle.kind === 'directory') {
			files.push(
				...(await collectFiles(handle as FileSystemDirectoryHandle, path)),
			);
		} else {
			files.push({ path, handle: handle as FileSystemFileHandle });
		}
	}
	files.sort((a, b) => a.path.localeCompare(b.path));
	return files;
}

// Render the collected files as clickable rows in the existing sidebar.
function renderSidebar(files: MapFile[]): void {
	const sidebar = document.getElementById('map-sidebar');
	if (!sidebar) return;
	sidebar.replaceChildren();

	if (files.length === 0) {
		sidebar.textContent = 'No files found.';
		return;
	}

	for (const file of files) {
		const item = document.createElement('div');
		item.className = 'map-item';
		item.textContent = file.path;
		item.addEventListener('click', () => {
			void selectFile(file);
		});
		sidebar.appendChild(item);
	}
}

async function selectFile(file: MapFile): Promise<void> {
	try {
		const text = await (await file.handle.getFile()).text();
		loadMap(JSON.parse(text))
	} catch (err) {
		console.error(`Could not load map ${file.path}`, err);
	}
}

// Load the maps directory for a root handle and populate the sidebar.
async function loadMaps(root: FileSystemDirectoryHandle): Promise<void> {
	try {
		const mapsDir = await getMapsDir(root);
		const files = await collectFiles(mapsDir);
		console.log(`Found ${files.length} file(s) under ${MAPS_PATH.join('/')}/`);
		renderSidebar(files);

		// Auto-load a specific map for quick iteration during development.
		const auto = files.find(
			(f) => f.path.replace(/\.[^.]+$/, '').replace(/\//g, '.') === AUTO_LOAD_MAP,
		);
		if (auto) void selectFile(auto);
		else console.warn(`Auto-load map not found: ${AUTO_LOAD_MAP}`);
	} catch (err) {
		console.error(`Could not read ${MAPS_PATH.join('/')}/:`, err);
		renderSidebar([]);
	}
}

async function pickFolder(): Promise<void> {
	try {
		const handle = await window.showDirectoryPicker();
		await set(HANDLE_KEY, handle);
		await loadMaps(handle);
	} catch (err) {
		if ((err as DOMException).name !== 'AbortError') console.error(err);
	}
}

async function restoreFolder(): Promise<void> {
	try {
		const handle = await get<FileSystemDirectoryHandle>(HANDLE_KEY);
		if (!handle) return;
		if ((await handle.queryPermission({ mode: 'read' })) === 'granted') {
			await loadMaps(handle);
		} else {
			console.log('Stored folder needs permission — click "Open folder".');
		}
	} catch (err) {
		console.error(err);
	}
}

export function setupFolderPicker(): void {
	const openButton = document.getElementById('open-folder');
	openButton?.addEventListener('click', () => {
		void pickFolder();
	});

	const toggle = document.getElementById('toggle-list');
	toggle?.addEventListener('click', () => {
		const sidebar = document.getElementById('map-sidebar');
		if (!sidebar) return;
		sidebar.classList.toggle('hidden');
	});

	// Try to restore a folder chosen in a previous session.
	void restoreFolder();
}
