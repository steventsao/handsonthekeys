import { cloudflare } from "@cloudflare/vite-plugin"
import { sites } from "@openai/sites-vite-plugin"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import hostingConfig from "./.openai/hosting.json" with { type: "json" }

const CLOUDFLARE_DATABASE_ID =
  (
    globalThis as typeof globalThis & {
      readonly process?: { readonly env?: { readonly CLOUDFLARE_DATABASE_ID?: string } }
    }
  ).process?.env?.CLOUDFLARE_DATABASE_ID ?? "00000000-0000-0000-0000-000000000000"

const d1Databases = hostingConfig.d1
  ? [
      {
        binding: hostingConfig.d1,
        database_name: "hands-on-the-keys",
        database_id: CLOUDFLARE_DATABASE_ID
      }
    ]
  : []

export default defineConfig({
  server: {
    watch: {
      ignored: ["**/coverage/**", "**/playwright-report/**", "**/test-results/**"]
    }
  },
  plugins: [
    react(),
    sites(),
    cloudflare({
      viteEnvironment: { name: "server" },
      config: {
        main: "./worker/index.ts",
        compatibility_date: "2026-05-22",
        compatibility_flags: ["nodejs_compat"],
        workers_dev: true,
        routes: [
          { pattern: "handsonthekeys.com", custom_domain: true },
          { pattern: "www.handsonthekeys.com", custom_domain: true }
        ],
        d1_databases: d1Databases,
        assets: {
          binding: "ASSETS",
          not_found_handling: "single-page-application",
          run_worker_first: ["/api/*", "/healthz"]
        }
      }
    })
  ],
  environments: {
    client: {
      build: {
        rollupOptions: {
          input: {
            main: "index.html",
            karaoke: "karaoke.html"
          }
        }
      }
    }
  }
})
