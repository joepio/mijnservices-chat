import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/search": "http://localhost:8787",
      "/chat": "http://localhost:8787",
      "/document": "http://localhost:8787",
      "/sources": "http://localhost:8787",
      "/images": "http://localhost:8787",
    },
  },
});
