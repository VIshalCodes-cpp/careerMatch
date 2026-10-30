import { describe, expect, it } from "vitest";
import { parseResumeText } from "./resume-parser";

describe("parseResumeText education extraction", () => {
  it("does not treat education keywords in a profile summary as an institution", () => {
    const parsed = parseResumeText([
      "Jordan Lee",
      "Motivated bachelor in technology seeking an opportunity to grow.",
      "Experienced developer with strong communication and teamwork skills.",
    ].join("\n"));

    expect(parsed.education).toEqual([]);
  });

  it("pairs degree and institution lines from the education section", () => {
    const parsed = parseResumeText([
      "Jordan Lee",
      "EDUCATION",
      "Bachelor of Technology in Computer Science",
      "Example Institute of Technology",
      "2020 - 2024",
      "SKILLS",
      "Worked with a university team on a software project.",
    ].join("\n"));

    expect(parsed.education).toEqual([
      "Bachelor of Technology in Computer Science — Example Institute of Technology",
    ]);
  });

  it("does not parse unrelated degree or institution mentions outside the education section", () => {
    const parsed = parseResumeText([
      "Jordan Lee",
      "Motivated bachelor in technology",
      "Software developer",
      "Worked with Example University on a project.",
    ].join("\n"));

    expect(parsed.education).toEqual([]);
  });
});

describe("parseResumeText common resume layouts", () => {
  it("extracts contact details and fields from inline section headings", () => {
    const parsed = parseResumeText([
      "Amina O’Connor",
      "Pune, Maharashtra, India | amina@example.com | +91 98765 43210",
      "PROFESSIONAL SUMMARY: Senior product designer with 6 years of experience building accessible products.",
      "SKILLS: Figma, UX Design, Jira",
      "WORK EXPERIENCE: Acme | Senior Product Designer | 2021 - Present",
      "EDUCATION: B.Sc. Computer Science",
      "Example University",
    ].join("\n"));

    expect(parsed.name).toBe("Amina O’Connor");
    expect(parsed.email).toBe("amina@example.com");
    expect(parsed.phone).toBe("+91 98765 43210");
    expect(parsed.location).toBe("Pune, Maharashtra, India");
    expect(parsed.summary).toContain("Senior product designer");
    expect(parsed.skills).toEqual(expect.arrayContaining(["Figma", "UX Design", "Jira"]));
    expect(parsed.jobTitles).toEqual(["Senior Product Designer"]);
    expect(parsed.education).toEqual(["B.Sc. Computer Science — Example University"]);
    expect(parsed.experienceYears).toBe(6);
  });

  it("recognizes experience sections and a job title after the employer name", () => {
    const parsed = parseResumeText([
      "Alex Morgan",
      "EXPERIENCE",
      "Northwind Labs | Backend Engineer | 2022 - Present",
      "Built APIs with TypeScript and PostgreSQL.",
      "EDUCATION",
      "Bachelor of Science in Computer Science",
    ].join("\n"));

    expect(parsed.jobTitles).toEqual(["Backend Engineer"]);
  });

  it("extracts a location presented in its own section", () => {
    const parsed = parseResumeText([
      "Ravi Kumar",
      "LOCATION",
      "Bengaluru, India",
      "SKILLS",
      "Python, SQL",
    ].join("\n"));

    expect(parsed.location).toBe("Bengaluru, India");
  });
});
