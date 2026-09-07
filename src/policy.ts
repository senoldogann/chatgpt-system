import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { PolicyError } from "./errors.js";

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function nearestExistingAncestor(candidate: string): Promise<string> {
  let current = candidate;
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw new PolicyError("Could not find an existing ancestor for path.", { candidate });
      current = parent;
    }
  }
}

async function canonicalizePath(candidate: string): Promise<string> {
  const ancestor = await nearestExistingAncestor(candidate);
  const realAncestor = await realpath(ancestor);
  const suffix = path.relative(ancestor, candidate);
  return suffix === "" ? realAncestor : path.resolve(realAncestor, suffix);
}

export class PathPolicy {
  constructor(readonly roots: string[]) {}

  async resolve(input: string): Promise<string> {
    if (!input.trim()) throw new PolicyError("Path must not be empty.");

    const candidate = path.isAbsolute(input)
      ? path.resolve(input)
      : path.resolve(this.roots[0]!, input);

    const lexicalRoot = this.roots.find((root) => isInside(root, candidate));
    if (lexicalRoot) {
      const canonicalRoot = await canonicalizePath(lexicalRoot);
      const canonicalCandidate = await canonicalizePath(candidate);
      if (!isInside(canonicalRoot, canonicalCandidate)) {
        throw new PolicyError("Path escapes an allowed root through a symlink.", {
          requested: input,
          resolved: candidate,
        });
      }
      return candidate;
    }

    const canonicalCandidate = await canonicalizePath(candidate);
    for (const root of this.roots) {
      const canonicalRoot = await canonicalizePath(root);
      if (isInside(canonicalRoot, canonicalCandidate)) return candidate;
    }

    throw new PolicyError("Path is outside all allowed roots.", { requested: input, roots: this.roots });
  }

  display(candidate: string): string {
    const root = this.roots.find((item) => isInside(item, candidate));
    if (!root) return candidate;
    const relative = path.relative(root, candidate);
    return relative === "" ? "." : relative;
  }
}
