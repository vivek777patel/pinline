import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The web app lives in web/. In dev, proxy API calls to the local server (port 4000).
// In production, `npm run build:web` emits web/dist, which the server serves directly.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: { "/api": "http://localhost:4000" },
  },
});
