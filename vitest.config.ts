import { defineConfig } from "vitest/config";

export default defineConfig({
  // jsdom everywhere, not just for the `.tsx` files. The client builds
  // `FormData` and `Blob` bodies, so testing it in a node environment would test
  // a different code path than the one that ships to a browser.
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
    restoreMocks: true,
  },
  esbuild: {
    jsx: "automatic",
  },
});
