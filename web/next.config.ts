import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce the minimal server image used by Azure Container Apps.
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": [
      "./.test-cache/**/*",
      "./scripts/**/*",
      "./tests/**/*",
      "./node_modules/@huggingface/transformers/**/*",
      "./node_modules/@mintplex-labs/piper-tts-web/**/*",
      "./node_modules/phonemizer/**/*",
      "./node_modules/better-sqlite3/**/*",
      "./node_modules/drizzle-kit/**/*",
    ],
  },

  turbopack: {
    // Stub Node built-ins for the BROWSER only, so Emscripten libraries that
    // `require("fs")` behind a Node guard (e.g. @mintplex-labs/piper-tts-web)
    // bundle for the client. The server still gets the real modules.
    resolveAlias: {
      fs: { browser: "./src/lib/browser-empty.ts" },
      path: { browser: "./src/lib/browser-empty.ts" },
      crypto: { browser: "./src/lib/browser-empty.ts" },
      module: { browser: "./src/lib/browser-empty.ts" },
      worker_threads: { browser: "./src/lib/browser-empty.ts" },
    },
  },
};

export default nextConfig;
