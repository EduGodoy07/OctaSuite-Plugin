import { describe, expect, it } from "vitest";
import { validateLeadDraft, PIPELINE_STAGES, LEAD_SOURCES } from "../src/domain/lead.js";

describe("Lead domain", () => {
  it("rejects empty name", () => {
    const errors = validateLeadDraft({ name: "" });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("name");
  });

  it("accepts minimal valid draft", () => {
    expect(validateLeadDraft({ name: "Acme" })).toHaveLength(0);
  });

  it("validates email format", () => {
    const errors = validateLeadDraft({ name: "X", email: "not-an-email" });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("email");
  });

  it("accepts valid email", () => {
    expect(validateLeadDraft({ name: "X", email: "a@b.com" })).toHaveLength(0);
  });

  it("rejects negative estimated value", () => {
    const errors = validateLeadDraft({ name: "X", estimatedValue: -100 });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("estimatedValue");
  });

  it("rejects invalid stage", () => {
    const errors = validateLeadDraft({ name: "X", stage: "invalid" as any });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("stage");
  });

  it("rejects invalid source", () => {
    const errors = validateLeadDraft({ name: "X", source: "invalid" as any });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("source");
  });

  it("PIPELINE_STAGES has 7 entries", () => {
    expect(PIPELINE_STAGES).toHaveLength(7);
  });

  it("LEAD_SOURCES has 7 entries", () => {
    expect(LEAD_SOURCES).toHaveLength(7);
  });
});
