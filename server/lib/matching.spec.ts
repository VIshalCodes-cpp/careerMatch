import { describe, expect, it } from "vitest";
import { cosineSimilarity, experienceCompatibility, skillOverlap, weightedFit, ScoreWeights } from "./matching";

describe("profile and job matching", () => {
  it("counts required skills fully and preferred skills at half weight", () => {
    const result = skillOverlap(["python", "sql"], ["docker"], new Set(["python", "docker"]));
    expect(result.score).toBeCloseTo(0.6);
    expect(result.matched).toEqual(["python", "docker"]);
    expect(result.missingRequired).toEqual(["sql"]);
  });

  it("scores experience compatibility against a published range", () => {
    expect(experienceCompatibility(2, 1, 3)).toBe(1);
    expect(experienceCompatibility(1, 2, 4)).toBe(0.5);
    expect(experienceCompatibility(5, 2, 3)).toBe(0.9);
    expect(experienceCompatibility(null, 2, 3)).toBe(0.5);
  });

  it("uses cosine similarity and rejects incompatible vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("renormalizes content-only scores when the ML/collaborative signals are unavailable", () => {
    const weights: ScoreWeights = { semantic: 0.35, skills: 0.25, experience: 0.15, education: 0.05, preference: 0.15, collaborative: 0.05 };
    const components = { semantic: 0, skills: 1, experience: 1, education: 0.5, preference: 0.5, collaborative: 0 };
    expect(weightedFit(components, weights, { semantic: false, collaborative: false })).toBeCloseTo(0.833333);
    expect(weightedFit({ ...components, semantic: 1 }, weights, { semantic: true, collaborative: true })).toBeCloseTo(0.85);
  });
});
