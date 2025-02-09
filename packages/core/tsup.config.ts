import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/threadsPool/worker.ts",
    "src/static/vitePluginDepSpy.ts",
  ],
  publicDir: "public",
  external: ["vite", "rollup"],
  splitting: false,
  sourcemap: true,
  format: ["esm", "cjs"],
  clean: true,
  dts: true,
});
