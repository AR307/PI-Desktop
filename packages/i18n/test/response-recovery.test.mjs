import { expect, test } from "vitest";
import { catalogs } from "../src/index.ts";

for (const [locale, catalog] of Object.entries(catalogs)) {
  test(`${locale} provides readable response recovery messages`, () => {
    for (const code of ["MODEL_THINKING_ONLY", "MODEL_OUTPUT_TRUNCATED"]) {
      const text = catalog.errors[code];
      expect(typeof text).toBe("string");
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).not.toMatch(/[?�]/);
    }
  });
}
