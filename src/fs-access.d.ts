// Minimal ambient types for the File System Access API, which isn't covered
// by TypeScript's default DOM lib.

interface FileSystemHandlePermissionDescriptor {
	mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
	queryPermission(
		descriptor?: FileSystemHandlePermissionDescriptor,
	): Promise<PermissionState>;
	requestPermission(
		descriptor?: FileSystemHandlePermissionDescriptor,
	): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
	entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}

interface Window {
	showDirectoryPicker(options?: {
		mode?: 'read' | 'readwrite';
	}): Promise<FileSystemDirectoryHandle>;
}