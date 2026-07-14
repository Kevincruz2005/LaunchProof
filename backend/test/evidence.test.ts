import { describe, expect, it } from "vitest";
import { hashJcs, sha256, toJcs } from "../src/evidence/canonical.js";

describe("canonical evidence", () => {
  it("sorts object keys deterministically", () => {
    expect(toJcs({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
    expect(hashJcs({ z: 1, a: 2 })).toBe(hashJcs({ a: 2, z: 1 }));
  });

  it("matches a known SHA-256 vector", () => {
    expect(sha256("abc")).toBe("0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
