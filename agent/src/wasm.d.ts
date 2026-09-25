/**
 * A `.wasm` import is a compiled module, not bytes: Wrangler bundles the binary and
 * hands the Worker a `WebAssembly.Module` to instantiate. Declared here because the
 * only one the agent imports — libopus, in opus.ts — has no types of its own.
 */
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
