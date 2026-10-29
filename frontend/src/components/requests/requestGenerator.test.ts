import { describe, expect, it } from "vitest";
import { generateRequest, templates } from "./requestGenerator";

describe("local request generation", () => {
  it("respects explicit scenarios and produces valid synthetic identities", () => {
    for (const scenario of ["standard", "rag"] as const) {
      for (const value of [0, 0.2, 0.4, 0.6, 0.8, 0.999]) {
        const result = generateRequest(scenario, undefined, () => value);
        expect(result.scenario).toBe(scenario);
        expect(result.preview.sender_email).toMatch(
          /^[a-z]+\.[a-z]+@example\.com$/,
        );
        expect(result.preview.sender_name.length).toBeGreaterThan(3);
        expect(result.preview.subject.trim()).not.toBe("");
        expect(result.preview.body).toContain(
          result.preview.sender_name.split(" ")[0],
        );
      }
    }
  });
  it("Random can choose either group", () => {
    expect(generateRequest("random", undefined, () => 0).scenario).toBe(
      "standard",
    );
    expect(generateRequest("random", undefined, () => 0.99).scenario).toBe(
      "rag",
    );
  });
  it("regeneration avoids the previous template even with a fixed random source", () => {
    const first = generateRequest("rag", undefined, () => 0);
    const second = generateRequest("rag", first.templateId, () => 0);
    expect(second.templateId).not.toBe(first.templateId);
    expect(second.preview.body).not.toBe(first.preview.body);
  });
  it("RAG templates stay within seeded refund, billing review and support SLA topics", () => {
    expect(
      templates.filter((t) => t.scenario === "rag").map((t) => t.id),
    ).toEqual([
      "refund-within",
      "refund-outside",
      "billing-policy",
      "outage-sla",
      "normal-sla",
    ]);
    expect(generateRequest("rag", undefined, () => 0).preview.body).toContain(
      "2 days ago",
    );
    expect(
      generateRequest("rag", undefined, () => 0.21).preview.body,
    ).toContain("45 days ago");
  });
  it("varies names, invoice references, amounts and wording", () => {
    const first = generateRequest("standard", undefined, () => 0).preview;
    // This still selects the invoice template, with different randomized details.
    const second = generateRequest("standard", undefined, () => 0.19).preview;
    expect(first.sender_name).not.toBe(second.sender_name);
    expect(first.subject).not.toBe(second.subject);
    expect(first.body).not.toBe(second.body);
  });
});
