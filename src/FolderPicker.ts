// Folder picker that persists the chosen directory handle in IndexedDB (via
// idb-keyval) so the same folder can be reused across page reloads.

import { get, set } from 'idb-keyval';

const HANDLE_KEY = 'folder';

// Walk the directory and log its entries to the console.
async function printContents(dir: FileSystemDirectoryHandle): Promise<void> {
	console.log(`Contents of "${dir.name}":`);
	for await (const [name, handle] of dir.entries()) {
		console.log(`  ${handle.kind === 'directory' ? '[dir]' : '[file]'} ${name}`);
	}
}

async function pickFolder(): Promise<void> {
	try {
		const handle = await window.showDirectoryPicker();
		await set(HANDLE_KEY, handle);
		await printContents(handle);
	} catch (err) {
		if ((err as DOMException).name !== 'AbortError') console.error(err);
	}
}

async function restoreFolder(): Promise<void> {
	try {
		const handle = await get<FileSystemDirectoryHandle>(HANDLE_KEY);
		if (!handle) return;
		if ((await handle.queryPermission({ mode: 'read' })) === 'granted') {
			await printContents(handle);
		} else {
			console.log('Stored folder needs permission — click "Open folder".');
		}
	} catch (err) {
		console.error(err);
	}
}

export function setupFolderPicker(): void {
	const button = document.createElement('button');
	button.textContent = 'Open folder';
	button.style.cssText =
		'position:fixed;top:8px;left:8px;z-index:10;padding:6px 12px;';
	button.addEventListener('click', () => {
		void pickFolder();
	});
	document.body.appendChild(button);

	// Try to restore a folder chosen in a previous session.
	void restoreFolder();
}