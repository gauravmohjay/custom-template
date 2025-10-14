import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
   plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist"
  },  server: {
    host: '0.0.0.0',
    port: 5174,
     allowedHosts: ['host.docker.internal']
  }
});
