import { describe, expect, it } from "vitest";
import { compileGlob } from "../src/core/glob-match.js";

function matches(glob: string, paths: string[]): string[] {
  const test = compileGlob(glob);
  return paths.filter(test);
}

const paths = [
  "package.json",
  "src/server.ts",
  "src/fs/fs-service.ts",
  "src/fs/fs-service.test.tsx",
  "tests/server.test.ts",
  "docs/README.md",
];

describe("compileGlob", () => {
  it("matches basename-only patterns at any depth", () => {
    expect(matches("*.ts", paths)).toEqual(["src/server.ts", "src/fs/fs-service.ts", "tests/server.test.ts"]);
  });

  it("keeps single-star inside one path segment", () => {
    expect(matches("src/*.ts", paths)).toEqual(["src/server.ts"]);
  });

  it("lets ** span zero or more directories", () => {
    expect(matches("src/**/*.ts", paths)).toEqual(["src/server.ts", "src/fs/fs-service.ts"]);
    expect(matches("**/README.md", paths)).toEqual(["docs/README.md"]);
    expect(matches("src/**", paths)).toEqual(["src/server.ts", "src/fs/fs-service.ts", "src/fs/fs-service.test.tsx"]);
  });

  it("supports brace alternatives, ? and character classes", () => {
    expect(matches("**/*.{ts,tsx}", paths)).toHaveLength(4);
    expect(matches("src/?s/*", paths)).toEqual(["src/fs/fs-service.ts", "src/fs/fs-service.test.tsx"]);
    expect(matches("[pd]*", paths)).toEqual(["package.json"]);
    expect(matches("[!p]*.json", paths)).toEqual([]);
  });

  it("treats regex metacharacters literally and strips a leading ./", () => {
    expect(matches("./package.json", paths)).toEqual(["package.json"]);
    expect(compileGlob("a+b.(c)")("a+b.(c)")).toBe(true);
    expect(compileGlob("a+b.(c)")("aab.xc")).toBe(false);
  });

  it("rejects empty or malformed globs", () => {
    expect(() => compileGlob("")).toThrow(/Glob/);
    expect(() => compileGlob("src/{a,b")).toThrow(/unclosed/);
  });
});
