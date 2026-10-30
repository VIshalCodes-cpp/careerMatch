const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  euro: "€",
  pound: "£",
  yen: "¥",
  rupee: "₹",
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  bull_alt: "•",
};

function decodeEntitiesOnce(value: string) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Normalizes whitespace while preserving paragraph breaks. */
export function tidyText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Converts HTML (including double-encoded job-description HTML) into plain text. */
export function htmlToText(html: string): string {
  if (!html) return "";
  let value = html;
  // Some feeds double-encode their HTML; decode twice before stripping tags.
  value = decodeEntitiesOnce(value);
  value = decodeEntitiesOnce(value);
  value = value.replace(/<\s*(script|style|noscript)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ");
  value = value.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  value = value.replace(/<\s*\/\s*(p|div|li|ul|ol|h[1-6]|tr|table|section|article|blockquote)\s*>/gi, "\n");
  value = value.replace(/<\s*li[^>]*>/gi, "• ");
  value = value.replace(/<\s*(p|div|h[1-6]|tr|table|section|article|blockquote)[^>]*>/gi, "\n");
  value = value.replace(/<[^>]+>/g, " ");
  return tidyText(value);
}

/** Removes HTML entirely for short excerpts. */
export function plainExcerpt(html: string, max = 220) {
  const text = htmlToText(html).replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

const STOPWORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves will can just also may might must now new years year work working role job team teams company companies candidate candidates applicant applicants including using use used ability able across within without via etc plus one two three our us get make made take set help support benefits salary remote`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Tokenizes text for lexical similarity, keeping meaningful tech symbols
 * such as c++, c#, .net and node.js.
 */
export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((token) => token.length > 1 && token.length < 40 && !STOPWORDS.has(token));
}

function termFrequencies(tokens: string[]) {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

/**
 * TF-IDF cosine similarity between one query document and a set of documents.
 * Runs fully in-process (no API key, no Python service) and returns 0..1 scores.
 */
export function tfidfSimilarities(query: string, documents: string[]): number[] {
  if (!documents.length) return [];
  const queryTokens = tokenize(query);
  const documentTokens = documents.map((document) => tokenize(document));
  if (!queryTokens.length) return documents.map(() => 0);

  const documentFrequency = new Map<string, number>();
  for (const tokens of documentTokens) {
    for (const token of new Set(tokens)) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
  for (const token of new Set(queryTokens)) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);

  const total = documents.length + 1;
  const idf = (token: string) => Math.log((total + 1) / ((documentFrequency.get(token) ?? 0) + 1)) + 1;

  const vectorize = (tokens: string[]) => {
    const frequencies = termFrequencies(tokens);
    const vector = new Map<string, number>();
    let squared = 0;
    for (const [token, count] of frequencies) {
      const weight = (1 + Math.log(count)) * idf(token);
      vector.set(token, weight);
      squared += weight * weight;
    }
    return { vector, norm: Math.sqrt(squared) };
  };

  const queryVector = vectorize(queryTokens);
  if (!queryVector.norm) return documents.map(() => 0);

  return documentTokens.map((tokens) => {
    const { vector, norm } = vectorize(tokens);
    if (!norm) return 0;
    let dot = 0;
    for (const [token, weight] of queryVector.vector) {
      const other = vector.get(token);
      if (other) dot += weight * other;
    }
    return Math.max(0, Math.min(1, dot / (queryVector.norm * norm)));
  });
}

/**
 * Calibrates raw TF-IDF cosine values (which are naturally small for long
 * documents) into a friendlier 0..1 semantic signal.
 */
export function calibrateSemantic(raw: number) {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.max(0, Math.min(1, Math.pow(raw * 2.6, 0.85)));
}

export function firstSentence(value: string, max = 180) {
  const text = value.replace(/\s+/g, " ").trim();
  const sentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return sentence.length > max ? `${sentence.slice(0, max).replace(/\s+\S*$/, "")}…` : sentence;
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}
