// Native-session rejection tests must not reach the operating-system recycle bin.
export async function resolve(specifier, context, next) {
  if (specifier === "electron") {
    return {
      url: "data:text/javascript," + encodeURIComponent(
        'export const shell = { trashItem: async () => { throw new Error("Unexpected recycle-bin access"); } };',
      ),
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}
