import type { Config } from "tailwindcss";
import baseConfig from "./tailwind.config";

export default {
  ...baseConfig,
  content: ["./src/seo/static-pages.ts"],
} satisfies Config;