import { describe, it, expect } from "vitest";
import { extractPickupArea } from "./address-privacy";

describe("extractPickupArea", () => {
  describe("redacts unsafe inputs and fails closed when needed", () => {
    it("returns null for null/undefined/empty", () => {
      expect(extractPickupArea(null)).toBeNull();
      expect(extractPickupArea(undefined)).toBeNull();
      expect(extractPickupArea("")).toBeNull();
      expect(extractPickupArea("   ")).toBeNull();
    });

    it("returns null for single-line addresses (no commas)", () => {
      expect(extractPickupArea("123 Main Street")).toBeNull();
    });

    it("returns null when the only non-street segment is a unit token", () => {
      // Previously leaked "Apt 4B" — this is the core vulnerability.
      expect(extractPickupArea("123 Main St, Apt 4B")).toBeNull();
      expect(extractPickupArea("123 Main St, Apartment 4B")).toBeNull();
      expect(extractPickupArea("123 Main St, Unit 12")).toBeNull();
      expect(extractPickupArea("123 Main St, Suite 200")).toBeNull();
      expect(extractPickupArea("123 Main St, Ste 200")).toBeNull();
      expect(extractPickupArea("123 Main St, Building C")).toBeNull();
      expect(extractPickupArea("123 Main St, Bldg C")).toBeNull();
      expect(extractPickupArea("123 Main St, Floor 3")).toBeNull();
      expect(extractPickupArea("123 Main St, Fl 3")).toBeNull();
      expect(extractPickupArea("123 Main St, Room 101")).toBeNull();
      expect(extractPickupArea("123 Main St, Lot 7")).toBeNull();
      expect(extractPickupArea("123 Main St, #12")).toBeNull();
      expect(extractPickupArea("123 Main St, PO Box 99")).toBeNull();
    });

    it("returns null for bare unit numbers in the second segment", () => {
      expect(extractPickupArea("123 Main St, 4B")).toBeNull();
      expect(extractPickupArea("123 Main St, #3")).toBeNull();
    });

    it("returns null when the surviving tail has no state/ZIP", () => {
      // Free-form garbage second segment that is not a unit token but also
      // not a recognizable locality — fail closed.
      expect(extractPickupArea("123 Main St, the blue house")).toBeNull();
      expect(extractPickupArea("123 Main St, near the park")).toBeNull();
    });

    it("never returns an unrecognized building or residence label", () => {
      expect(extractPickupArea("123 Main St, Tower Seven, IL")).toBe("IL");
      expect(extractPickupArea("123 Main St, Blue Building, IL 62701")).toBe(
        "IL 62701",
      );
      expect(extractPickupArea("123 Main St, Residence 4B, 62701")).toBe(
        "62701",
      );
    });

    it("drops ZIP+4 precision that can identify a building or residence", () => {
      expect(extractPickupArea("123 Main St, NY 10118-0110")).toBe("NY 10118");
      expect(extractPickupArea("123 Main St, New York, NY, 10118-0110")).toBe(
        "NY, 10118",
      );
      expect(extractPickupArea("123 Main St, 10118-0110")).toBe("10118");
    });
  });

  describe("returns a safe locality for well-structured addresses", () => {
    it("returns 'City, ST ZIP' for a standard 4-part address", () => {
      expect(extractPickupArea("123 Main St, Springfield, IL, 62701")).toBe(
        "IL, 62701",
      );
    });

    it("returns 'City, ST ZIP' for a 3-part address (city + state+zip)", () => {
      expect(extractPickupArea("123 Main St, Springfield, IL 62701")).toBe(
        "IL 62701",
      );
    });

    it("strips a unit segment between street and locality", () => {
      // The vulnerability: previously this might have included "Apt 4B" in
      // the visible area. We now drop unit segments entirely.
      expect(
        extractPickupArea("123 Main St, Apt 4B, Springfield, IL 62701"),
      ).toBe("IL 62701");
      expect(
        extractPickupArea("123 Main St, Building C, Austin, TX 78701"),
      ).toBe("TX 78701");
    });

    it("accepts address whose tail ends with a 5-digit ZIP only", () => {
      expect(extractPickupArea("123 Main St, Springfield, 62701")).toBe(
        "62701",
      );
    });

    it("accepts a state abbreviation without a ZIP", () => {
      expect(extractPickupArea("123 Main St, Springfield, IL")).toBe(
        "IL",
      );
    });

    it("normalizes whitespace and ignores empty segments", () => {
      expect(
        extractPickupArea("  123 Main St ,  Springfield ,  IL 62701 , "),
      ).toBe("IL 62701");
    });
  });
});
