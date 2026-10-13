import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { GLOSSARY, glossary } from "../src/web/glossary.ts";

/** Every .tsx file under a directory. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

test("every term on screen has a glossary entry", () => {
  const used = new Set<string>();
  for (const file of sources("src/web")) {
    for (const m of readFileSync(file, "utf8").matchAll(/<Term id="([^"]+)"/g)) used.add(m[1]!);
  }
  assert.ok(used.size >= 8, `terms used: ${[...used].join(", ")}`);
  for (const id of used) assert.doesNotThrow(() => glossary(id), `missing glossary entry "${id}"`);
});

test("glossary entries are unique and say something", () => {
  const ids = GLOSSARY.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of GLOSSARY) assert.ok(e.text.length > 40 && e.term.length > 0, e.id);
});
