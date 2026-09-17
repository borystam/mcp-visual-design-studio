import { defineConfig } from "vite";
export default defineConfig({
  root: "src/ui",
  base: "/",
  build: { outDir: "../../dist/ui", emptyOutDir: true },
  server: { host: "127.0.0.1" },
});
