export type JobSkill = { id?: string; name: string; normalizedName?: string; required: boolean };

export type CompanySummary = { id: string; name: string; logoUrl?: string | null; website?: string | null; location?: string | null };

export type MatchComponents = {
  semantic: number;
  skills: number;
  experience: number;
  education: number;
  preference: number;
  collaborative: number;
};

export type MatchFit = {
  score: number;
  scorePercent: number;
  matchedSkills: string[];
  missingRequiredSkills: string[];
  components: MatchComponents;
  method?: string;
};

export type Job = {
  id: string;
  title: string;
  description?: string;
  excerpt?: string;
  searchText?: string | null;
  location: string;
  employmentType?: string | null;
  experienceMin?: number | null;
  experienceMax?: number | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  status?: string;
  source?: "RECRUITER" | "EXTERNAL";
  sourceName?: string | null;
  sourceLabel?: string;
  sourceJobId?: string | null;
  applyUrl?: string | null;
  publishedAt?: string | null;
  expiresAt?: string | null;
  createdAt?: string;
  company: CompanySummary;
  companyId?: string;
  skills: JobSkill[];
  saved?: boolean;
  applied?: boolean;
  applicationStatus?: string | null;
  score?: number;
  scorePercent?: number;
  method?: string;
  matchedSkills?: string[];
  missingRequiredSkills?: string[];
  components?: MatchComponents;
  fit?: MatchFit | null;
  _count?: { applications: number };
  similarJobs?: Job[];
  savedAt?: string;
};

export type ApplicationRecord = {
  id: string;
  status: string;
  coverLetter?: string | null;
  appliedAt: string;
  updatedAt?: string;
  resume?: { id: string; originalName: string } | null;
  job: Job;
};

export type NotificationRecord = {
  id: string;
  title: string;
  message: string;
  readAt?: string | null;
  createdAt: string;
};

export type ProfileSkill = { skill: { id: string; name: string; normalizedName: string }; years?: number | null; proficiency?: string | null };

export type CandidateProfile = {
  id?: string;
  headline?: string | null;
  summary?: string | null;
  location?: string | null;
  experienceYears?: number | null;
  currentRole?: string | null;
  careerGoal?: string | null;
  preferredLocations?: string[];
  preferredEmployment?: string[];
  desiredSalaryMin?: number | null;
  desiredSalaryMax?: number | null;
  skills?: ProfileSkill[];
  education?: any[];
  experience?: any[];
  certifications?: any[];
};

export type ResumeRecord = {
  id: string;
  originalName: string;
  mimeType?: string;
  sizeBytes?: number;
  status: string;
  processingError?: string | null;
  parsedData?: any;
  createdAt?: string;
  processedAt?: string | null;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  pages: number;
  facets?: { employmentTypes: { value: string; count: number }[]; sources: { value: string; count: number }[] };
};

export type Overview = {
  unreadNotifications: number;
  candidate?: {
    savedJobs: number;
    applications: number;
    activeApplications: number;
    resumes: number;
    recommendationCount: number;
    profileComplete: number;
    hasProfile: boolean;
    currentRole?: string | null;
    skills: number;
  } | null;
  recruiter?: {
    jobs: number;
    published: number;
    drafts: number;
    applications: number;
    newApplications: number;
  } | null;
};
