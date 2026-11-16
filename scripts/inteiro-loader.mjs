import { stripTypeScriptTypes } from "node:module";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.includes("@inteiro/") && url.endsWith(".ts")) {
    const source = await readFile(new URL(url), "utf8");
    return {
      format: "module",
      source: stripTypeScriptTypes(source, { mode: "strip", sourceUrl: url }),
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
