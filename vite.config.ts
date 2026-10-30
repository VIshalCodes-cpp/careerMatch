import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { createServer } from "./server";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    watch: {
      ignored: [
        "**/ml-service/**",
        "**/.pnpm-store/**",
        "**/.cache/**",
        "**/.tmp/**",
        "**/.private/**",
        "**/dist/**",
        "**/node_modules/**",
      ],
    },
    fs: {
      allow: ["./client", "./shared", "index.html"],
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "server/**"],
    },
  },
  build: {
    outDir: "dist/spa",
  },
  plugins: [react(), fastifyPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
}));

function fastifyPlugin(): Plugin {
  return {
    name: "fastify-plugin",
    apply: "serve", // Only apply during development (serve mode)
    configureServer(server) {
      const app = createServer();
      const ready = app.ready();

      // Pass API requests through the same Fastify instance used by Vercel.
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/api/")) return next();
        void Promise.resolve(ready).then(() => app.server.emit("request", request, response)).catch(next);
      });
    },
  };
}
