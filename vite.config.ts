import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The game runs the same sim code as the tests and the command line: src/sim
// has no Node-only imports, so the browser bundle takes it as is.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: true },
});
