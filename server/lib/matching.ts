export function skillOverlap(required: string[], preferred: string[], candidateSkills: Set<string>) {
  const matched = [...new Set([...required, ...preferred].filter((skill) => candidateSkills.has(skill)))];
  const missingRequired = [...new Set(required.filter((skill) => !candidateSkills.has(skill)))];
  const denominator = required.length + preferred.length * 0.5;
  const score = denominator ? (required.filter((skill) => candidateSkills.has(skill)).length + preferred.filter((skill) => candidateSkills.has(skill)).length * 0.5) / denominator : 0;
  return { score, matched, missingRequired };
}

export function experienceCompatibility(candidateYears: number | null | undefined, minimum: number | null | undefined, maximum: number | null | undefined) {
  if (candidateYears == null || minimum == null) return 0.5;
  if (candidateYears < minimum) return Math.max(0, 1 - (minimum - candidateYears) / Math.max(minimum, 1));
  if (maximum == null || candidateYears <= maximum) return 1;
  return Math.max(0.4, 1 - (candidateYears - maximum) / 20);
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return 0;
  const dot = left.reduce((sum, value, index) => sum + value * right[index], 0);
  const leftNorm = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0));
  const rightNorm = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0));
  if (!leftNorm || !rightNorm) return 0;
  return Math.max(0, Math.min(1, dot / (leftNorm * rightNorm)));
}

export type ScoreComponents = { semantic: number; skills: number; experience: number; education: number; preference: number; collaborative: number };
export type ScoreWeights = Record<keyof ScoreComponents, number>;

export function weightedFit(components: ScoreComponents, weights: ScoreWeights, available: { semantic: boolean; collaborative: boolean }) {
  const active = { ...weights };
  if (!available.semantic) active.semantic = 0;
  if (!available.collaborative) active.collaborative = 0;
  const total = Object.values(active).reduce((sum, weight) => sum + weight, 0);
  if (!total) return 0;
  return Object.entries(active).reduce((sum, [key, weight]) => {
    const value = components[key as keyof ScoreComponents];
    return sum + Math.max(0, Math.min(1, value)) * weight;
  }, 0) / total;
}
