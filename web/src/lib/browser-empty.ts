// Empty stub for Node built-ins (fs, path, crypto, …) that Emscripten-based
// browser libraries — e.g. @mintplex-labs/piper-tts-web — `require()` behind a
// `typeof process === 'object'` (Node) guard that never runs in the browser.
// Turbopack aliases those built-ins to this module for the browser target only;
// the server keeps the real modules. See next.config.ts → turbopack.resolveAlias.
const stub: Record<string, unknown> = {}
export default stub
