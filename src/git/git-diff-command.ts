/** Build a fixed read-only Git diff invocation; callers cannot supply Git options. */
export function buildGitDiffArgs(staged: boolean, check: boolean): string[] {
  return [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    ...(staged ? ["--cached"] : []),
    ...(check ? ["--check"] : []),
  ];
}
