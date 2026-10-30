import "dotenv/config";
import argon2 from "argon2";
import { prisma } from "../server/lib/database";
import { storeResume } from "../server/services/resume-storage";
import { parseResumeText, canonicalSkills } from "../server/services/resume-parser";

/**
 * Optional demo data for local evaluation only. Creates three accounts with
 * known credentials, a company with listings, and one fully completed
 * candidate profile. Never run this against a production database.
 * Usage: pnpm demo:seed
 */
const DEMO = {
  admin: { email: "admin@careermatch.dev", password: "AdminPass12345", name: "Avery Admin" },
  recruiter: { email: "recruiter@careermatch.dev", password: "RecruiterPass123", name: "Riley Recruiter" },
  candidate: { email: "candidate@careermatch.dev", password: "CandidatePass123", name: "Jordan Candidate" },
};

const RESUME_TEXT = `Jordan Candidate
Bengaluru, India | jordan.candidate@example.com | +91 98765 43210

SUMMARY
Frontend developer with 4 years of experience building accessible React applications and design systems. Moving toward full-stack product engineering with TypeScript, Node.js and PostgreSQL.

SKILLS
TypeScript, React, JavaScript, Node.js, HTML, CSS, Tailwind CSS, Git, SQL, Figma, Testing, REST API

EXPERIENCE
Frontend Developer | Brightlane | 2022 - Present
Built a React design system used by 6 product teams, migrated the dashboard to TypeScript, and improved Lighthouse performance from 62 to 94.

Junior Developer | Pixelforge | 2021 - 2022
Delivered customer-facing marketing pages and integrated a headless CMS.

EDUCATION
B.Tech Computer Science | VIT University | 2017 - 2021

CERTIFICATIONS
Meta Front-End Developer Certificate

PROJECTS
Career portfolio with case studies and interactive prototypes.
`;

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Builds a small but valid text-based PDF for the demo resume. */
function buildDemoPdf(lines: string[]) {
  const content = ["BT", "/F1 11 Tf", "72 740 Td", "14 TL", ...lines.map((line) => `(${escapePdfText(line.slice(0, 110))}) Tj T*`), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

async function upsertUser(email: string, name: string, password: string, roles: string[], extra: any = {}) {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { name, passwordHash, emailVerifiedAt: new Date() } });
    for (const role of roles) await prisma.userRole.upsert({ where: { userId_role: { userId: existing.id, role: role as any } }, create: { userId: existing.id, role: role as any }, update: {} });
    return existing;
  }
  return prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      emailVerifiedAt: new Date(),
      roles: { create: roles.map((role) => ({ role: role as any })) },
      ...extra,
    },
  });
}

async function main() {
  const admin = await upsertUser(DEMO.admin.email, DEMO.admin.name, DEMO.admin.password, ["ADMIN"]);
  const recruiter = await upsertUser(DEMO.recruiter.email, DEMO.recruiter.name, DEMO.recruiter.password, ["RECRUITER"], { recruiter: { create: {} } });
  const candidate = await upsertUser(DEMO.candidate.email, DEMO.candidate.name, DEMO.candidate.password, ["CANDIDATE"], { candidate: { create: {} } });

  await prisma.recruiterProfile.upsert({ where: { userId: recruiter.id }, create: { userId: recruiter.id }, update: {} });

  let company = await prisma.company.findFirst({ where: { name: "Northwind Labs" } });
  company ??= await prisma.company.create({
    data: {
      name: "Northwind Labs",
      website: "https://northwind.example.com",
      location: "Bengaluru, India",
      description: "Northwind Labs builds developer tools for distributed teams. We are a small, product-led team that ships weekly and invests in thoughtful engineering.",
    },
  });
  await prisma.recruiterProfile.update({ where: { userId: recruiter.id }, data: { companyId: company.id, title: "Talent Lead" } });

  const listings = [
    {
      title: "Senior Full Stack Engineer",
      location: "Bengaluru, India · Hybrid",
      employmentType: "Full-time",
      experienceMin: 4,
      experienceMax: 8,
      salaryMin: 2_800_000,
      salaryMax: 4_200_000,
      description: `Northwind Labs is looking for a Senior Full Stack Engineer to own features end to end across our React and Node.js stack.

What you will do
- Design and ship product features from database schema to polished UI.
- Improve reliability of our API and background jobs.
- Mentor two engineers and raise the bar for testing and code review.

What we look for
- 4+ years building production web applications.
- Strong TypeScript, React and Node.js experience.
- Comfortable with PostgreSQL, Docker and CI/CD.
- Clear written communication in a remote-friendly team.

We offer a learning budget, home-office allowance, and flexible hours.`,
      skills: ["TypeScript", "React", "Node.js", "PostgreSQL", "AWS", "Docker", "System Design"],
    },
    {
      title: "Data Analyst",
      location: "Remote · India",
      employmentType: "Full-time",
      experienceMin: 1,
      experienceMax: 4,
      salaryMin: 1_200_000,
      salaryMax: 1_800_000,
      description: `We are hiring a Data Analyst to help product teams make better decisions with clear metrics and honest analysis.

Responsibilities
- Build and maintain SQL models and dashboards for product and growth teams.
- Investigate funnel drops and translate findings into recommendations.
- Partner with engineering on event tracking quality.

Requirements
- 1+ years of analytics experience with SQL and Python.
- Experience with Power BI or Tableau and Excel.
- Strong statistics fundamentals and communication.`,
      skills: ["SQL", "Python", "Power BI", "Excel", "Statistics", "Data Visualization"],
    },
    {
      title: "Product Designer",
      location: "Remote",
      employmentType: "Contract",
      experienceMin: 2,
      experienceMax: 5,
      salaryMin: 1_000_000,
      salaryMax: 1_500_000,
      description: `Northwind Labs is looking for a Product Designer on a 6-month contract to shape our next generation of developer tooling.

You will
- Turn ambiguous problems into flows, wireframes, and high-fidelity prototypes.
- Extend and document our design system in Figma.
- Run lightweight usability tests and share findings with the team.

You bring
- A portfolio showing complex B2B or developer-facing products.
- Strong UI and UX craft, with attention to accessibility.
- Comfortable collaborating with engineers in a fast feedback loop.`,
      skills: ["Figma", "UI Design", "UX Design", "Communication", "Prototyping"],
    },
  ];

  const jobs = [] as any[];
  for (const listing of listings) {
    let job = await prisma.job.findFirst({ where: { title: listing.title, companyId: company.id, createdById: recruiter.id } });
    if (!job) {
      job = await prisma.job.create({
        data: {
          source: "RECRUITER",
          title: listing.title,
          description: listing.description,
          searchText: listing.description.slice(0, 3000),
          location: listing.location,
          employmentType: listing.employmentType,
          experienceMin: listing.experienceMin,
          experienceMax: listing.experienceMax,
          salaryMin: listing.salaryMin,
          salaryMax: listing.salaryMax,
          salaryCurrency: "INR",
          status: "PUBLISHED",
          publishedAt: new Date(),
          expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
          companyId: company.id,
          createdById: recruiter.id,
        },
      });
      for (const name of listing.skills) {
        const normalizedName = name.toLowerCase();
        const skill = await prisma.skill.upsert({ where: { normalizedName }, create: { name, normalizedName }, update: {} });
        await prisma.jobSkill.create({ data: { jobId: job.id, skillId: skill.id, required: true } });
      }
    }
    jobs.push(job);
  }

  let profile = await prisma.candidateProfile.findUnique({ where: { userId: candidate.id } });
  profile ??= await prisma.candidateProfile.create({ data: { userId: candidate.id } });
  await prisma.candidateProfile.update({
    where: { id: profile.id },
    data: {
      headline: "Frontend developer moving toward full-stack",
      summary: "I build accessible React interfaces and design systems. I am deepening my backend skills with Node.js and PostgreSQL and looking for a product team where I can own features end to end.",
      location: "Bengaluru, India",
      experienceYears: 4,
      currentRole: "Frontend Developer",
      careerGoal: "Full Stack Engineer",
      preferredLocations: ["Bengaluru", "Remote"],
      preferredEmployment: ["Full-time", "Contract"],
      desiredSalaryMin: 2_000_000,
      desiredSalaryMax: 3_600_000,
      embedding: [],
    },
  });

  const profileSkills = ["TypeScript", "React", "JavaScript", "Node.js", "HTML", "CSS", "Tailwind CSS", "Git", "SQL", "Figma", "Testing", "REST API"];
  await prisma.candidateSkill.deleteMany({ where: { profileId: profile.id } });
  for (const name of canonicalSkills(profileSkills)) {
    const skill = await prisma.skill.upsert({ where: { normalizedName: name.toLowerCase() }, create: { name, normalizedName: name.toLowerCase() }, update: {} });
    await prisma.candidateSkill.create({ data: { profileId: profile.id, skillId: skill.id } });
  }

  await prisma.education.deleteMany({ where: { profileId: profile.id } });
  await prisma.education.create({ data: { profileId: profile.id, institution: "VIT University", degree: "B.Tech", field: "Computer Science", startDate: new Date("2017-08-01"), endDate: new Date("2021-05-31") } });
  await prisma.workExperience.deleteMany({ where: { profileId: profile.id } });
  await prisma.workExperience.createMany({
    data: [
      { profileId: profile.id, company: "Brightlane", title: "Frontend Developer", location: "Bengaluru", startDate: new Date("2022-06-01"), current: true, description: "Built a React design system used by six product teams and migrated the dashboard to TypeScript." },
      { profileId: profile.id, company: "Pixelforge", title: "Junior Developer", location: "Remote", startDate: new Date("2021-06-01"), endDate: new Date("2022-05-31"), current: false, description: "Delivered customer-facing marketing pages and integrated a headless CMS." },
    ],
  });

  let resume = await prisma.resume.findFirst({ where: { userId: candidate.id } });
  if (!resume) {
    const bytes = buildDemoPdf(RESUME_TEXT.split("\n"));
    const fileKey = await storeResume(bytes, "pdf");
    const parsed = parseResumeText(RESUME_TEXT);
    resume = await prisma.resume.create({
      data: {
        userId: candidate.id,
        fileKey,
        originalName: "Jordan-Candidate-Resume.pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
        status: "PROCESSED",
        extractedText: RESUME_TEXT,
        parsedData: parsed as any,
        processedAt: new Date(),
      },
    });
    const resumeSkills = canonicalSkills(parsed.skills);
    if (resumeSkills.length) {
      await prisma.skill.createMany({ data: resumeSkills.map((name) => ({ name, normalizedName: name.toLowerCase() })), skipDuplicates: true });
      const saved = await prisma.skill.findMany({ where: { normalizedName: { in: resumeSkills.map((name) => name.toLowerCase()) } }, select: { id: true } });
      await prisma.candidateSkill.createMany({ data: saved.map((skill) => ({ profileId: profile.id, skillId: skill.id })), skipDuplicates: true });
    }
  }

  const primaryJob = jobs[0];
  const existingApplication = await prisma.jobApplication.findUnique({ where: { userId_jobId: { userId: candidate.id, jobId: primaryJob.id } } });
  if (!existingApplication) {
    await prisma.jobApplication.create({
      data: {
        userId: candidate.id,
        jobId: primaryJob.id,
        resumeId: resume.id,
        coverLetter: "I have spent the last three years building React design systems and shipping customer-facing features. I would love to bring that product craft to Northwind Labs and grow into full-stack ownership.",
        status: "IN_REVIEW",
      },
    });
    await prisma.notification.create({ data: { userId: recruiter.id, title: "New application", message: `Jordan Candidate applied for ${primaryJob.title}.` } });
  }
  await prisma.savedJob.upsert({ where: { userId_jobId: { userId: candidate.id, jobId: jobs[2].id } }, create: { userId: candidate.id, jobId: jobs[2].id }, update: {} });

  console.log("Demo data ready:");
  console.table([
    { role: "Admin", email: DEMO.admin.email, password: DEMO.admin.password },
    { role: "Recruiter", email: DEMO.recruiter.email, password: DEMO.recruiter.password },
    { role: "Candidate", email: DEMO.candidate.email, password: DEMO.candidate.password },
  ]);
  console.log(`Company: ${company.name} · Listings: ${jobs.length} · Admin id: ${admin.id}`);
}

main()
  .catch((error) => {
    console.error("Demo seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
