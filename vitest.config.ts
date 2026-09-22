import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      // El paquete npm "obsidian" es solo tipos (sin entry runtime): en
      // tests node se resuelve contra un stub local.
      obsidian: path.resolve(__dirname, "packages/obsidian-plugin/tests/obsidian-stub.ts"),
    },
  },
});