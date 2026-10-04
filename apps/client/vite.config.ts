import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react()],
    server: {
      port: 3000,
      strictPort: true,
      host: "0.0.0.0",
      proxy: {
        "/colyseus": {
          target: env.VITE_SERVER_URL || "http://localhost:2567",
          ws: true,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/colyseus/, ""),
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: { phaser: ["phaser"], colyseus: ["@colyseus/sdk"] },
        },
      },
    },
  };
});
