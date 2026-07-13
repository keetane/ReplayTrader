import { describe, expect, it } from "vitest";
import { formatTseTickPrice } from "./format";

describe("formatTseTickPrice", () => {
  it("formats prices rounded to TOPIX500 quote units", () => {
    expect(formatTseTickPrice(999.96)).toBe("1,000");
    expect(formatTseTickPrice(1_000.3)).toBe("1,000.5");
    expect(formatTseTickPrice(3_000.6)).toBe("3,001");
    expect(formatTseTickPrice(10_003)).toBe("10,005");
    expect(formatTseTickPrice(100_026)).toBe("100,050");
  });
});
