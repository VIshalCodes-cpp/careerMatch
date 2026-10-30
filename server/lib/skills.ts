export type SkillDefinition = { name: string; aliases?: string[] };

/**
 * A curated, license-free skill vocabulary used for resume extraction, job
 * import enrichment, and canonical names in the database. Extend freely.
 */
export const SKILL_LIBRARY: SkillDefinition[] = [
  { name: "TypeScript", aliases: ["ts", "typescript"] },
  { name: "JavaScript", aliases: ["js", "javascript", "ecmascript"] },
  { name: "Python" },
  { name: "Java" },
  { name: "C++", aliases: ["cpp", "c plus plus"] },
  { name: "C#", aliases: ["csharp", "c sharp"] },
  { name: ".NET", aliases: ["dotnet", "asp.net", "dot net"] },
  { name: "Go", aliases: ["golang"] },
  { name: "Rust" },
  { name: "PHP" },
  { name: "Ruby", aliases: ["ruby on rails", "rails"] },
  { name: "Swift" },
  { name: "Kotlin" },
  { name: "Scala" },
  { name: "React", aliases: ["reactjs", "react.js"] },
  { name: "Next.js", aliases: ["nextjs", "next js"] },
  { name: "Vue.js", aliases: ["vue", "vuejs"] },
  { name: "Angular", aliases: ["angularjs"] },
  { name: "Svelte", aliases: ["sveltekit"] },
  { name: "React Native" },
  { name: "Flutter" },
  { name: "Node.js", aliases: ["node", "nodejs"] },
  { name: "Express", aliases: ["expressjs", "express.js"] },
  { name: "Fastify" },
  { name: "Django" },
  { name: "Flask" },
  { name: "FastAPI" },
  { name: "Spring Boot", aliases: ["spring"] },
  { name: "Laravel" },
  { name: "GraphQL" },
  { name: "REST API", aliases: ["rest", "restful api", "rest apis"] },
  { name: "HTML", aliases: ["html5"] },
  { name: "CSS", aliases: ["css3"] },
  { name: "Tailwind CSS", aliases: ["tailwind", "tailwindcss"] },
  { name: "Sass", aliases: ["scss"] },
  { name: "Redux" },
  { name: "jQuery" },
  { name: "Webpack" },
  { name: "Vite" },
  { name: "SQL" },
  { name: "PostgreSQL", aliases: ["postgres"] },
  { name: "MySQL" },
  { name: "MongoDB", aliases: ["mongo"] },
  { name: "Redis" },
  { name: "Elasticsearch", aliases: ["elastic search"] },
  { name: "Prisma" },
  { name: "DynamoDB" },
  { name: "Firebase" },
  { name: "Supabase" },
  { name: "Docker" },
  { name: "Kubernetes", aliases: ["k8s"] },
  { name: "AWS", aliases: ["amazon web services"] },
  { name: "Azure", aliases: ["microsoft azure"] },
  { name: "GCP", aliases: ["google cloud", "google cloud platform"] },
  { name: "Terraform" },
  { name: "Ansible" },
  { name: "Linux" },
  { name: "Git" },
  { name: "CI/CD", aliases: ["ci cd", "continuous integration", "continuous delivery"] },
  { name: "Jenkins" },
  { name: "GitHub Actions" },
  { name: "Machine Learning", aliases: ["ml"] },
  { name: "Deep Learning" },
  { name: "Natural Language Processing", aliases: ["nlp"] },
  { name: "Computer Vision" },
  { name: "Generative AI", aliases: ["genai", "gen ai", "llm", "llms"] },
  { name: "Statistics" },
  { name: "Scikit-learn", aliases: ["scikit learn", "sklearn"] },
  { name: "TensorFlow" },
  { name: "PyTorch" },
  { name: "Pandas" },
  { name: "NumPy" },
  { name: "Data Analysis", aliases: ["data analytics"] },
  { name: "Data Visualization" },
  { name: "Power BI", aliases: ["powerbi"] },
  { name: "Tableau" },
  { name: "Excel", aliases: ["ms excel", "microsoft excel", "spreadsheets"] },
  { name: "Airflow", aliases: ["apache airflow"] },
  { name: "Spark", aliases: ["apache spark", "pyspark"] },
  { name: "Hadoop" },
  { name: "Kafka", aliases: ["apache kafka"] },
  { name: "ETL" },
  { name: "Data Engineering" },
  { name: "System Design" },
  { name: "API Design" },
  { name: "Microservices" },
  { name: "Testing", aliases: ["unit testing", "test automation"] },
  { name: "Jest" },
  { name: "Cypress" },
  { name: "Playwright" },
  { name: "Selenium" },
  { name: "Agile" },
  { name: "Scrum" },
  { name: "Jira" },
  { name: "Product Management" },
  { name: "Project Management" },
  { name: "Communication" },
  { name: "Leadership" },
  { name: "Stakeholder Communication", aliases: ["stakeholder management"] },
  { name: "UI Design" },
  { name: "UX Design", aliases: ["user experience"] },
  { name: "Figma" },
  { name: "Adobe Photoshop", aliases: ["photoshop"] },
  { name: "Illustrator" },
  { name: "SEO", aliases: ["search engine optimization"] },
  { name: "Content Marketing" },
  { name: "Digital Marketing" },
  { name: "Google Analytics" },
  { name: "Salesforce" },
  { name: "SAP" },
  { name: "QuickBooks" },
  { name: "Accounting" },
  { name: "Financial Analysis" },
  { name: "Customer Support", aliases: ["customer service"] },
  { name: "Technical Support" },
  { name: "Sales" },
  { name: "Recruiting", aliases: ["talent acquisition"] },
  { name: "Human Resources", aliases: ["hr"] },
  { name: "Operations" },
  { name: "Supply Chain" },
  { name: "Cybersecurity", aliases: ["information security", "infosec"] },
  { name: "Penetration Testing", aliases: ["pen testing"] },
  { name: "Networking", aliases: ["tcp/ip"] },
  { name: "Windows" },
  { name: "VMware" },
  { name: "JUnit" },
  { name: "Go-to-Market", aliases: ["gtm"] },
];

type CompiledSkill = { name: string; patterns: RegExp[] };

const COMPILED: CompiledSkill[] = SKILL_LIBRARY.map((skill) => {
  const terms = [skill.name, ...(skill.aliases ?? [])];
  return {
    name: skill.name,
    patterns: terms.map(
      (term) => new RegExp(`(^|[^a-z0-9+#.])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9+#.])`, "i"),
    ),
  };
});

const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const skill of SKILL_LIBRARY) {
  ALIAS_TO_CANONICAL.set(skill.name.toLowerCase(), skill.name);
  for (const alias of skill.aliases ?? []) ALIAS_TO_CANONICAL.set(alias.toLowerCase(), skill.name);
}

/** Returns canonical skill names found in free text, in library order. */
export function extractSkills(text: string, limit = 40): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const skill of COMPILED) {
    if (found.length >= limit) break;
    if (skill.patterns.some((pattern) => pattern.test(text))) found.push(skill.name);
  }
  return found;
}

/** Canonicalizes a user-entered skill name (e.g. "ts" -> "TypeScript"). */
export function normalizeSkillName(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim().slice(0, 100);
  if (!cleaned) return cleaned;
  return ALIAS_TO_CANONICAL.get(cleaned.toLowerCase()) ?? cleaned;
}

/** True when a skill is part of the known vocabulary. */
export function isKnownSkill(value: string) {
  return ALIAS_TO_CANONICAL.has(value.toLowerCase());
}
