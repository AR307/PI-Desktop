// Native-session rejection tests must not reach the operating-system recycle bin.
const source = 'export const shell = { trashItem: async () => { throw new Error("Unexpected recycle-bin access"); } };';

export async function resolve(specifier, context, next) {
  if (specifier === "electron") {
    return {
      url: "data:text/javascript," + encodeURIComponent(source),
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}

/** Apply the same native boundary when Main is loaded through Vite SSR. */
export function electronShellFixture() {
  const moduleId = "\0test-electron-shell";
  return {
    name: "test-electron-shell",
    enforce: "pre",
    resolveId(id) { if (id === "electron") return moduleId; },
    load(id) { if (id === moduleId) return source; },
  };
}
