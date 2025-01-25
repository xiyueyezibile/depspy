import { defineConfig, loadEnv } from "vite";
import reactPlugin from "@vitejs/plugin-react";
import UnoCSS from "unocss/vite";
import path from "path";
import generate404 from "./plugins/generate404";
import neutralization from "./plugins/neutralization";
import { vitePluginInsight } from "@dep-spy/core/vitePluginInsight";
export default defineConfig(({ mode }) => {
  const { VITE_BUILD_MODE } = loadEnv(mode, path.join(process.cwd(), "env"));
  return {
    build: {
      outDir: VITE_BUILD_MODE == "online" ? "dist/online" : "dist/vite",
      rollupOptions: {
        output: {
          manualChunks: {
            g6: ["@antv/g6"],
          },
        },
      },
      sourcemap: true,
    },
    envDir: "./env",

    plugins: [
      reactPlugin(),
      UnoCSS(),
      generate404(),
      neutralization([
        "@swc/core",
        "tsconfig-paths",
        "@babel/traverse",
        "swc-to-babel",
        "worker_threads",
        "os",
        "events",
        "fs",
        "path"
      ]),
      vitePluginInsight({
        entry: path.join(__dirname, "../view/src/main.tsx"),
        root: process.cwd(), // 项目根目录
        pkgPath: path.join(process.cwd(), "/package.json"), // package.json 路径
      })
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        "~": path.resolve(__dirname, "types"),
      },
    },
  };
});
