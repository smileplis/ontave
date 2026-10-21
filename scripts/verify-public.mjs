import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
for (const file of files) {
  assert.ok(
    !/^(?:research\/|artifacts\/|\.env$|\.env\.(?!example$)|docs\/isolation-baseline\.json|.*node_modules\/)/.test(
      file,
    ),
    "Private path was tracked",
  );
  const data = await readFile(file, "utf8");
  assert.ok(
    !/AIza[0-9A-Za-z_-]{35}|gsk_[0-9A-Za-z]{40,}/.test(data),
    "Credential pattern found in tracked content",
  );
}
console.log(
  JSON.stringify({
    ok: true,
    trackedFiles: files.length,
    researchTracked: false,
    credentialsFound: 0,
  }),
);
