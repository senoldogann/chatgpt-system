import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";

const EXECUTABLE_TEST_TMP_ROOT = path.resolve("node_modules", ".cache", "chatgpt-system-test-tmp");

export async function executableTestTemp(prefix: string): Promise<string> {
  await mkdir(EXECUTABLE_TEST_TMP_ROOT, { recursive: true });
  return mkdtemp(path.join(EXECUTABLE_TEST_TMP_ROOT, prefix));
}
