import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare's non-secret local state inside this project.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log settings when the Cloudflare plugin is loaded.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    build: {
      target: "es2022",
      sourcemap: false,
    },
    plugins: [
      sites(),
      cloudflare({
        persistState: { path: ".wrangler/state" },
        config: {
          name: "server",
          main: "./worker/index.ts",
          compatibility_date: "2026-05-15",
          assets: {
            binding: "ASSETS",
            html_handling: "none",
            not_found_handling: "none",
          },
        },
      }),
    ],
    server: {
      strictPort: true,
    },
  };
});
