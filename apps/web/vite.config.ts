import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      "@myosotis/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // dev: same-origin API through the vite dev server
      "/api": {
        target: process.env.HUB_URL ?? "http://127.0.0.1:8791",
        changeOrigin: true,
      },
    },
    watch: {
      // rust build output is constantly locked while compiling
      ignored: ["**/apps/desktop/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "es2022",
    cssMinify: true,
    reportCompressedSize: false,
  },
});
