/**
 * Module hooks that let `node --test` import main-process TypeScript directly.
 *
 * Node strips the types itself, but the sources use bundler-style relative
 * imports: extensionless specifiers (`./plugin-mcp`) and `.js` specifiers that
 * only exist as `.ts` or `.tsx` on disk. ESM resolution rejects both, so the exact
 * specifier is tried first and the TypeScript siblings second — a real `.js`
 * or `.mjs` file still wins, and nothing that already resolved changes.
 *
 * Register with:
 *   register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
 */
export async function resolve(specifier, context, next) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return next(specifier, context);
  }
  try {
    return await next(specifier, context);
  } catch (error) {
    const typescript = specifier.endsWith(".js")
      ? `${specifier.slice(0, -".js".length)}.ts`
      : /\.[a-z]+$/i.test(specifier)
        ? null
        : `${specifier}.ts`;
    if (typescript === null) throw error;
    try {
      return await next(typescript, context);
    } catch {
      return next(`${typescript.slice(0, -3)}.tsx`, context);
    }
  }
}

/** Node strips TypeScript, but JSX needs the same automatic transform as Vite. */
export async function load(url, context, next) {
  if (!url.endsWith(".tsx")) return next(url, context);
  const [{ readFile }, { default: ts }] = await Promise.all([
    import("node:fs/promises"),
    import("typescript"),
  ]);
  const source = await readFile(new URL(url), "utf8");
  const result = ts.transpileModule(source, {
    fileName: new URL(url).pathname,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  return { format: "module", source: result.outputText, shortCircuit: true };
}
