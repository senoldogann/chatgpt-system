import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverXcodeProjectChecks } from "../src/project-xcode-checks.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function projectFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "xcode-project-check-"));
  roots.push(root);
  const project = path.join(root, "OSJarvis.xcodeproj");
  await mkdir(path.join(project, "xcshareddata", "xcschemes"), { recursive: true });
  await writeFile(path.join(project, "project.pbxproj"), "// !$*UTF8*$!\n{ objects = {}; }\n");
  await writeFile(path.join(project, "xcshareddata", "xcschemes", "OSJarvis.xcscheme"),
    '<Scheme><BuildAction/><TestAction/></Scheme>\n');
  return root;
}

describe("Xcode project-check discovery", () => {
  it("derives only fixed shell-free macOS Debug tests and Release build from one shared scheme", async () => {
    const root = await projectFixture();
    expect(await discoverXcodeProjectChecks(root)).toEqual([
      {
        checkId: "xcode:test", kind: "test", command: "xcodebuild",
        args: ["-quiet", "-project", "OSJarvis.xcodeproj", "-scheme", "OSJarvis", "-configuration", "Debug",
          "-destination", "platform=macOS", "-parallel-testing-enabled", "NO", "-jobs", "2",
          "CODE_SIGNING_ALLOWED=NO", "SWIFT_TREAT_WARNINGS_AS_ERRORS=YES", "test"],
        cwd: ".", source: "OSJarvis.xcodeproj/xcshareddata/xcschemes/OSJarvis.xcscheme", execution: "admin-host",
      },
      {
        checkId: "xcode:release-build", kind: "build", command: "xcodebuild",
        args: ["-quiet", "-project", "OSJarvis.xcodeproj", "-scheme", "OSJarvis", "-configuration", "Release",
          "-destination", "platform=macOS", "-jobs", "2", "CODE_SIGNING_ALLOWED=NO",
          "SWIFT_TREAT_WARNINGS_AS_ERRORS=YES", "build"],
        cwd: ".", source: "OSJarvis.xcodeproj/xcshareddata/xcschemes/OSJarvis.xcscheme", execution: "admin-host",
      },
    ]);
  });

  it("fails closed for ambiguous project and scheme discovery", async () => {
    const root = await projectFixture();
    await mkdir(path.join(root, "Second.xcodeproj"));
    expect(await discoverXcodeProjectChecks(root)).toEqual([]);
    await rm(path.join(root, "Second.xcodeproj"), { recursive: true });
    await writeFile(path.join(root, "OSJarvis.xcodeproj", "xcshareddata", "xcschemes", "Other.xcscheme"),
      '<Scheme><BuildAction/><TestAction/></Scheme>');
    expect(await discoverXcodeProjectChecks(root)).toEqual([]);
  });

  it("rejects symlinked configuration, traversal-like names and missing build or test actions", async () => {
    const root = await projectFixture();
    const project = path.join(root, "OSJarvis.xcodeproj");
    const scheme = path.join(project, "xcshareddata", "xcschemes", "OSJarvis.xcscheme");
    await rm(scheme);
    await symlink(path.join(root, "outside.xcscheme"), scheme);
    expect(await discoverXcodeProjectChecks(root)).toEqual([]);
    await rm(scheme);
    await writeFile(scheme, "<Scheme><BuildAction/></Scheme>");
    expect(await discoverXcodeProjectChecks(root)).toEqual([]);
    await writeFile(scheme, "<Scheme><BuildAction/><TestAction/></Scheme>");
    await rm(path.join(project, "project.pbxproj"));
    await symlink(path.join(root, "outside.pbxproj"), path.join(project, "project.pbxproj"));
    expect(await discoverXcodeProjectChecks(root)).toEqual([]);
  });
});
