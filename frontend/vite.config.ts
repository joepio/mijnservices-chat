import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5152,
    proxy: {
      "/search": "http://localhost:3000",
      "/chat": "http://localhost:3000",
      "/document": "http://localhost:3000",
      "/sources": "http://localhost:3000",
      "/images": "http://localhost:3000",
    },
  },
});
