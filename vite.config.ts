import { astryxStylex } from "@astryxdesign/build/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    port: 4500,
  },
  ssr: {
    noExternal: ["@astryxdesign/core", "@astryxdesign/theme-neutral"],
    optimizeDeps: {
      exclude: ["@astryxdesign/core", "@astryxdesign/theme-neutral"],
    },
  },
  build: {
    cssTarget: "chrome123",
  },
  plugins: [
    ...astryxStylex(),
    tsconfigPaths({
      ignoreConfigErrors: true,
    }),
    tanstackStart({
      srcDirectory: "src",
    }),
    viteReact(),
  ],
});
