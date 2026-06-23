// Let TypeScript treat image imports as URL strings (Vite resolves them to the
// emitted asset path at build time). Normally provided by vite/client types.
declare module '*.png' {
	const src: string;
	export default src;
}
