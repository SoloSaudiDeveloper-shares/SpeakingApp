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

  async headers() {
    const contentSecurityPolicy = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "media-src 'self' data: blob:",
      "worker-src 'self' blob:",
      [
        "connect-src 'self' blob:",
        "https://huggingface.co https://*.huggingface.co https://*.hf.co",
        "http://127.0.0.1:17841",
        "http://127.0.0.1:8000 http://localhost:8000 https://127.0.0.1:8000 https://localhost:8000",
        "http://127.0.0.1:8880 http://localhost:8880 https://127.0.0.1:8880 https://localhost:8880",
      ].join(" "),
    ].join("; ");
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), geolocation=(), payment=(), usb=()",
        },
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ],
    }];
  },
};

export default nextConfig;
