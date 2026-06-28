import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle everything required to run the server into .next/standalone
  // — this is what the Electron app will execute at startup.
  output: "standalone",

  // Native modules / large libs that should stay external (not bundled by webpack)
  serverExternalPackages: ['better-sqlite3', '@huggingface/transformers'],

  // Force the file tracer to include better-sqlite3's native binary in the
  // standalone bundle. Without this, Next.js sees it as "external" and skips it.
  outputFileTracingIncludes: {
    '/**/*': [
      './node_modules/better-sqlite3/**/*',
      './node_modules/bindings/**/*',
      './node_modules/file-uri-to-path/**/*',
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
