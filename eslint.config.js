import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "native/**", "extension/**", "benchmarks/**"] },
  {
    files: ["src/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // async imzası arayüz uyumu içindir; kaldırmak senkron throw'u reddedilen
      // promise'ten doğrudan istisnaya çevirerek davranışı değiştirir.
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
);
