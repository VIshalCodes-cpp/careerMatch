import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Award, CheckCircle2, FileText, GraduationCap, Lock, Plus, Save, Sparkles, Trash2, UploadCloud, UserRound, X,
} from "lucide-react";
import Progress from "@/components/Progress";
import { api, Envelope } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatDate } from "@/lib/format";
import type { CandidateProfile, ResumeRecord } from "@/lib/types";

type ExperienceRow = { key: string; title: string; company: string; description: string };
type EducationRow = { key: string; institution: string; degree: string; field: string };
type CertificationRow = { key: string; name: string; issuer: string };
type ParsedResumeData = {
  location?: string | null;
  summary?: string | null;
  skills?: string[];
  education?: string[];
  jobTitles?: string[];
  certifications?: string[];
  experienceYears?: number | null;
};

function parsedEducationRow(value: string): EducationRow {
  const [degreeOrInstitution, institution] = value.split(/\s+—\s+/, 2);
  const degreeOnly = /^(?:bachelor|master|b\.?\s?tech|b\.?\s?e\.?|m\.?\s?tech|m\.?\s?e\.?|mba|ph\.?\s?d|doctorate|diploma|associate|bca|mca)\b/i.test(degreeOrInstitution);
  return {
    key: uid(),
    institution: institution ?? (degreeOnly ? "" : degreeOrInstitution),
    degree: institution || degreeOnly ? degreeOrInstitution : "",
    field: "",
  };
}

const SUGGESTED_SKILLS = ["TypeScript", "JavaScript", "React", "Node.js", "Python", "SQL", "PostgreSQL", "AWS", "Docker", "Kubernetes", "Figma", "Machine Learning", "Communication", "Project Management"];
const EMPLOYMENT_OPTIONS = ["Full-time", "Part-time", "Contract", "Internship", "Freelance"];
const uid = () => Math.random().toString(36).slice(2);

export default function Profile() {
  const { user, loading, reload } = useAuth();
  const [profile, setProfile] = useState<CandidateProfile>({});
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [experience, setExperience] = useState<ExperienceRow[]>([]);
  const [education, setEducation] = useState<EducationRow[]>([]);
  const [certifications, setCertifications] = useState<CertificationRow[]>([]);
  const [resumes, setResumes] = useState<ResumeRecord[]>([]);
  const [preview, setPreview] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const hydrateProfile = (data: CandidateProfile | null) => {
    const value = data ?? {};
    setProfile(value);
    setSkills((value.skills ?? []).map((entry) => entry.skill.name));
    setExperience((value.experience ?? []).map((entry: any) => ({ key: entry.id ?? uid(), title: entry.title ?? "", company: entry.company ?? "", description: entry.description ?? "" })));
    setEducation((value.education ?? []).map((entry: any) => ({ key: entry.id ?? uid(), institution: entry.institution ?? "", degree: entry.degree ?? "", field: entry.field ?? "" })));
    setCertifications((value.certifications ?? []).map((entry: any) => ({ key: entry.id ?? uid(), name: entry.name ?? "", issuer: entry.issuer ?? "" })));
  };

  const applyParsedToForm = (parsed: ParsedResumeData) => {
    setSkills((current) => {
      const names = new Set(current.map((skill) => skill.toLowerCase()));
      return [...current, ...(parsed.skills ?? []).filter((skill) => {
        const normalized = skill.toLowerCase();
        if (names.has(normalized)) return false;
        names.add(normalized);
        return true;
      })];
    });
    setProfile((current) => ({
      ...current,
      summary: current.summary || parsed.summary || "",
      location: current.location || parsed.location || "",
      currentRole: current.currentRole || parsed.jobTitles?.[0] || "",
      experienceYears: current.experienceYears ?? parsed.experienceYears ?? null,
    }));
    setExperience((current) => {
      const titles = new Set(current.map((row) => row.title.toLowerCase()));
      return [...current, ...(parsed.jobTitles ?? []).filter((title) => {
        const key = title.toLowerCase();
        if (titles.has(key)) return false;
        titles.add(key);
        return true;
      }).map((title) => ({ key: uid(), title, company: "", description: "" }))];
    });
    setEducation((current) => {
      const existing = new Set(current.map((row) => `${row.institution}|${row.degree}`.toLowerCase()));
      return [...current, ...(parsed.education ?? []).map(parsedEducationRow).filter((row) => {
        const key = `${row.institution}|${row.degree}`.toLowerCase();
        if (existing.has(key)) return false;
        existing.add(key);
        return true;
      })];
    });
    setCertifications((current) => {
      const names = new Set(current.map((row) => row.name.toLowerCase()));
      return [...current, ...(parsed.certifications ?? []).filter((name) => {
        const key = name.toLowerCase();
        if (names.has(key)) return false;
        names.add(key);
        return true;
      }).map((name) => ({ key: uid(), name, issuer: "" }))];
    });
  };

  const loadResumes = async () => {
    const result = await api<Envelope<ResumeRecord[]>>("/me/resumes");
    setResumes(result.data);
  };

  const load = async () => {
    const [profileResult, resumeResult] = await Promise.all([
      api<Envelope<CandidateProfile>>("/me/profile"),
      api<Envelope<ResumeRecord[]>>("/me/resumes"),
    ]);
    hydrateProfile(profileResult.data);
    setResumes(resumeResult.data);
  };

  useEffect(() => {
    if (user?.roles.includes("CANDIDATE")) void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load your profile."));
  }, [user?.id]);

  const completeness = useMemo(() => {
    const checks = [Boolean(profile.currentRole), Boolean(profile.location), Boolean(profile.headline), profile.experienceYears != null, skills.length > 0, resumes.length > 0, Boolean(profile.summary), experience.length > 0];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [profile, skills, resumes, experience]);

  if (loading) return <main className="shell py-16 text-sm text-ink/50">Loading your profile…</main>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.roles.includes("CANDIDATE")) return <Navigate to="/recruiter" replace />;

  const addSkill = (value?: string) => {
    const name = (value ?? skillInput).replace(/\s+/g, " ").trim();
    if (!name) return;
    setSkills((current) => current.some((entry) => entry.toLowerCase() === name.toLowerCase()) ? current : [...current, name]);
    setSkillInput("");
  };

  const update = (key: keyof CandidateProfile, value: any) => setProfile((current) => ({ ...current, [key]: value }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setNotice("");
    setError("");
    if (!resumes.length) {
      setError("Upload at least one resume before saving your profile. Resume parsing now runs locally, so extraction works without an external service.");
      return;
    }
    if (!skills.length) {
      setError("Add at least one skill.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<Envelope<CandidateProfile>>("/me/profile", {
        method: "PUT",
        body: JSON.stringify({
          headline: profile.headline || null,
          summary: profile.summary || null,
          location: profile.location,
          experienceYears: profile.experienceYears === null || profile.experienceYears === undefined || String(profile.experienceYears) === "" ? null : Number(profile.experienceYears),
          currentRole: profile.currentRole,
          careerGoal: profile.careerGoal || null,
          preferredLocations: (profile.preferredLocations ?? []).filter(Boolean),
          preferredEmployment: (profile.preferredEmployment ?? []).filter(Boolean),
          desiredSalaryMin: profile.desiredSalaryMin ? Number(profile.desiredSalaryMin) : null,
          desiredSalaryMax: profile.desiredSalaryMax ? Number(profile.desiredSalaryMax) : null,
          skills,
          education: education.filter((row) => row.institution.trim()).map((row) => ({ institution: row.institution, degree: row.degree || undefined, field: row.field || undefined })),
          experience: experience.filter((row) => row.title.trim() && row.company.trim()).map((row) => ({ title: row.title, company: row.company, description: row.description || undefined, current: false })),
          certifications: certifications.filter((row) => row.name.trim()).map((row) => ({ name: row.name, issuer: row.issuer || undefined })),
        }),
      });
      hydrateProfile(result.data);
      setNotice("Profile saved. Recommendations will use these details on your next visit.");
      toast.success("Profile saved");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    setNotice("");
    setError("");
    const form = new FormData();
    form.append("file", file);
    try {
      const result = await api<Envelope<ResumeRecord>>("/me/resumes", { method: "POST", body: form });
      await loadResumes();
      const parsed = result.data.parsedData;
      if (result.data.status === "PROCESSED" && parsed) {
        applyParsedToForm(parsed);
        setNotice("Resume processed. Extracted details have been added to empty profile fields. Review and save your profile.");
      } else if (result.data.status === "FAILED") {
        setError(result.data.processingError ?? "This resume could not be parsed. You can still fill your profile manually.");
      } else {
        setNotice("Resume uploaded and processing.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not upload this resume.");
    } finally {
      setUploading(false);
    }
  };

  const reprocessResume = async (resume: ResumeRecord) => {
    setUploading(true);
    setNotice("");
    setError("");
    try {
      const result = await api<Envelope<ResumeRecord>>(`/me/resumes/${resume.id}/reprocess`, { method: "POST" });
      await loadResumes();
      if (result.data.status === "PROCESSED" && result.data.parsedData) {
        applyParsedToForm(result.data.parsedData);
        setNotice("Resume reprocessed. Updated extracted details have been added to empty profile fields. Review and save your profile.");
      } else {
        setError(result.data.processingError ?? "This resume could not be parsed. You can still fill your profile manually.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reprocess this resume.");
    } finally {
      setUploading(false);
    }
  };

  const openPreview = async (resume: ResumeRecord) => {
    try {
      const result = await api<Envelope<any>>(`/me/resumes/${resume.id}/parsed`);
      const parsed = result.data.parsedData ?? {};
      setPreview({
        id: resume.id,
        name: parsed.name ?? "",
        email: parsed.email ?? "",
        phone: parsed.phone ?? "",
        location: parsed.location ?? "",
        summary: parsed.summary ?? "",
        experienceYears: parsed.experienceYears ?? "",
        skills: (parsed.skills ?? []).join(", "),
        education: (parsed.education ?? []).join("\n"),
        jobTitles: (parsed.jobTitles ?? []).join("\n"),
        certifications: (parsed.certifications ?? []).join("\n"),
        projects: (parsed.projects ?? []).join("\n"),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load parsed fields.");
    }
  };

  const savePreview = async (event: FormEvent) => {
    event.preventDefault();
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<Envelope<{ parsedData: ParsedResumeData }>>(`/me/resumes/${preview.id}/parsed`, {
        method: "PUT",
        body: JSON.stringify({
          name: preview.name || undefined,
          email: preview.email || null,
          phone: preview.phone || null,
          location: preview.location || null,
          summary: preview.summary || null,
          experienceYears: preview.experienceYears === "" ? null : Number(preview.experienceYears),
          skills: String(preview.skills).split(",").map((entry: string) => entry.trim()).filter(Boolean),
          education: String(preview.education).split("\n").map((entry: string) => entry.trim()).filter(Boolean),
          jobTitles: String(preview.jobTitles).split("\n").map((entry: string) => entry.trim()).filter(Boolean),
          certifications: String(preview.certifications).split("\n").map((entry: string) => entry.trim()).filter(Boolean),
          projects: String(preview.projects).split("\n").map((entry: string) => entry.trim()).filter(Boolean),
        }),
      });
      setResumes((current) => current.map((resume) => resume.id === preview.id
        ? { ...resume, parsedData: result.data.parsedData }
        : resume));
      applyParsedToForm({
        location: result.data.parsedData.location,
        summary: result.data.parsedData.summary,
        experienceYears: result.data.parsedData.experienceYears,
        skills: result.data.parsedData.skills,
        education: result.data.parsedData.education,
        jobTitles: result.data.parsedData.jobTitles,
        certifications: result.data.parsedData.certifications,
      });
      setPreview(null);
      setNotice("Reviewed resume details saved to your profile.");
      toast.success("Corrected resume details saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save those details.");
    } finally {
      setBusy(false);
    }
  };

  const removeResume = async (resume: ResumeRecord) => {
    if (!window.confirm(`Delete ${resume.originalName}?`)) return;
    try {
      await api(`/me/resumes/${resume.id}`, { method: "DELETE" });
      setResumes((current) => current.filter((entry) => entry.id !== resume.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete this resume.");
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordNotice("");
    setPasswordError("");
    if (newPassword !== confirmPassword) {
      setPasswordError("The new passwords do not match.");
      return;
    }
    setPasswordBusy(true);
    try {
      await api("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      setPasswordNotice("Password updated. Every other device has been signed out.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (reason) {
      setPasswordError(reason instanceof Error ? reason.message : "Could not change your password.");
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <main className="shell py-10 md:py-14">
      <div className="flex flex-col justify-between gap-5 border-b border-ink/10 pb-8 md:flex-row md:items-end">
        <div>
          <p className="eyebrow"><UserRound size={12} /> Candidate profile</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-[-.06em] sm:text-5xl">Tell us what you bring.</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-ink/55">These details power matching, recruiter review, and your career-path suggestions. Everything is editable.</p>
        </div>
        <div className="w-full max-w-xs rounded-xl border border-ink/10 bg-card p-4">
          <div className="flex items-center justify-between text-xs"><span className="text-ink/50">Profile strength</span><span className="font-semibold text-coral">{completeness}%</span></div>
          <Progress value={completeness} className="mt-2" tone={completeness >= 80 ? "green" : "coral"} />
          <p className="mt-2 text-[11px] leading-4 text-ink/40">{completeness >= 80 ? "Detailed enough for a strong first pass." : "Missing sections lower your match quality."}</p>
        </div>
      </div>

      {notice && <p role="status" className="mt-5 rounded-xl border border-[#2f7a56]/25 bg-[#dff1e8]/60 px-4 py-3 text-sm text-[#27634e]">{notice}</p>}
      {error && <p role="alert" className="mt-5 rounded-xl border border-red-300/40 bg-red-50/60 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_330px]">
        <form onSubmit={save} className="space-y-5">
          <section className="panel">
            <div className="flex items-center justify-between"><h2 className="section-title !text-xl">Basics</h2><span className="text-[10px] uppercase tracking-[.14em] text-ink/30">Required *</span></div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="input-label md:col-span-2">Headline<input className="field mt-2" maxLength={180} value={profile.headline ?? ""} onChange={(event) => update("headline", event.target.value)} placeholder="Frontend developer moving into full-stack product work" /></label>
              <label className="input-label">Current role *<input className="field mt-2" required maxLength={180} value={profile.currentRole ?? ""} onChange={(event) => update("currentRole", event.target.value)} /></label>
              <label className="input-label">Location *<input className="field mt-2" required maxLength={180} value={profile.location ?? ""} onChange={(event) => update("location", event.target.value)} placeholder="Bengaluru, India" /></label>
              <label className="input-label">Years of experience<input className="field mt-2" type="number" min="0" max="80" step="0.5" value={profile.experienceYears ?? ""} onChange={(event) => update("experienceYears", event.target.value === "" ? null : Number(event.target.value))} /></label>
              <label className="input-label">Career goal<input className="field mt-2" maxLength={180} value={profile.careerGoal ?? ""} onChange={(event) => update("careerGoal", event.target.value)} placeholder="Full Stack Engineer" /></label>
              <label className="input-label md:col-span-2">Professional summary<textarea className="field-lg mt-2" maxLength={8000} value={profile.summary ?? ""} onChange={(event) => update("summary", event.target.value)} placeholder="A short paragraph about the work you do, the impact you have had, and what you want next." /></label>
            </div>
          </section>

          <section className="panel">
            <h2 className="section-title !text-xl">Skills *</h2>
            <p className="mt-1 text-sm text-ink/45">Add the tools and strengths you would be comfortable being interviewed on.</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {skills.map((skill) => (
                <span key={skill} className="inline-flex items-center gap-1.5 rounded-md bg-ink/[.06] px-2.5 py-1.5 text-xs text-ink/70">
                  {skill}
                  <button type="button" onClick={() => setSkills((current) => current.filter((entry) => entry !== skill))} aria-label={`Remove ${skill}`} className="text-ink/30 hover:text-red-600"><X size={11} /></button>
                </span>
              ))}
              {!skills.length && <span className="text-xs text-ink/35">No skills added yet.</span>}
            </div>
            <div className="mt-3 flex gap-2">
              <input className="field" value={skillInput} onChange={(event) => setSkillInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSkill(); } }} placeholder="Type a skill and press Enter" aria-label="Add a skill" />
              <button type="button" onClick={() => addSkill()} className="button button-outline !px-4"><Plus size={15} /></button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {SUGGESTED_SKILLS.filter((skill) => !skills.some((entry) => entry.toLowerCase() === skill.toLowerCase())).slice(0, 8).map((skill) => (
                <button key={skill} type="button" onClick={() => addSkill(skill)} className="chip !px-2 !py-1 !text-[11px]">+ {skill}</button>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2 className="section-title !text-xl">Preferences</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="input-label">Preferred locations <span className="font-normal text-ink/35">(comma separated)</span><input className="field mt-2" value={(profile.preferredLocations ?? []).join(", ")} onChange={(event) => update("preferredLocations", event.target.value.split(",").map((value) => value.trim()))} placeholder="Bengaluru, Remote" /></label>
              <label className="input-label">Desired salary min (INR/year)<input className="field mt-2" type="number" min="0" value={profile.desiredSalaryMin ?? ""} onChange={(event) => update("desiredSalaryMin", event.target.value === "" ? null : Number(event.target.value))} /></label>
              <label className="input-label md:col-span-2">Employment types</label>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                {EMPLOYMENT_OPTIONS.map((type) => {
                  const selected = (profile.preferredEmployment ?? []).includes(type);
                  return <button key={type} type="button" onClick={() => update("preferredEmployment", selected ? (profile.preferredEmployment ?? []).filter((entry) => entry !== type) : [...(profile.preferredEmployment ?? []), type])} className={`chip ${selected ? "chip-active" : ""}`}>{type}</button>;
                })}
              </div>
              <label className="input-label">Desired salary max (INR/year)<input className="field mt-2" type="number" min="0" value={profile.desiredSalaryMax ?? ""} onChange={(event) => update("desiredSalaryMax", event.target.value === "" ? null : Number(event.target.value))} /></label>
            </div>
          </section>

          <section className="panel">
            <div className="flex items-center justify-between">
              <h2 className="section-title flex items-center gap-2 !text-xl"><FileText size={17} /> Experience</h2>
              <button type="button" onClick={() => setExperience((current) => [...current, { key: uid(), title: "", company: "", description: "" }])} className="chip"><Plus size={13} /> Add role</button>
            </div>
            <div className="mt-4 space-y-3">
              {experience.map((row) => (
                <div key={row.key} className="rounded-xl border border-ink/10 p-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="input-label">Job title<input className="field mt-1.5" value={row.title} onChange={(event) => setExperience((current) => current.map((entry) => entry.key === row.key ? { ...entry, title: event.target.value } : entry))} /></label>
                    <label className="input-label">Company<input className="field mt-1.5" value={row.company} onChange={(event) => setExperience((current) => current.map((entry) => entry.key === row.key ? { ...entry, company: event.target.value } : entry))} /></label>
                    <label className="input-label md:col-span-2">What you did<textarea className="field-lg mt-1.5 !min-h-20" value={row.description} onChange={(event) => setExperience((current) => current.map((entry) => entry.key === row.key ? { ...entry, description: event.target.value } : entry))} /></label>
                  </div>
                  <button type="button" onClick={() => setExperience((current) => current.filter((entry) => entry.key !== row.key))} className="mt-2 text-xs text-ink/35 hover:text-red-600">Remove</button>
                </div>
              ))}
              {!experience.length && <p className="text-sm text-ink/40">No roles added yet.</p>}
            </div>
          </section>

          <section className="panel">
            <div className="flex items-center justify-between">
              <h2 className="section-title flex items-center gap-2 !text-xl"><GraduationCap size={18} /> Education</h2>
              <button type="button" onClick={() => setEducation((current) => [...current, { key: uid(), institution: "", degree: "", field: "" }])} className="chip"><Plus size={13} /> Add education</button>
            </div>
            <div className="mt-4 space-y-3">
              {education.map((row) => (
                <div key={row.key} className="grid gap-3 rounded-xl border border-ink/10 p-4 md:grid-cols-3">
                  <label className="input-label">Institution<input className="field mt-1.5" value={row.institution} onChange={(event) => setEducation((current) => current.map((entry) => entry.key === row.key ? { ...entry, institution: event.target.value } : entry))} /></label>
                  <label className="input-label">Degree<input className="field mt-1.5" value={row.degree} onChange={(event) => setEducation((current) => current.map((entry) => entry.key === row.key ? { ...entry, degree: event.target.value } : entry))} /></label>
                  <div className="flex items-end gap-2"><label className="input-label flex-1">Field<input className="field mt-1.5" value={row.field} onChange={(event) => setEducation((current) => current.map((entry) => entry.key === row.key ? { ...entry, field: event.target.value } : entry))} /></label><button type="button" onClick={() => setEducation((current) => current.filter((entry) => entry.key !== row.key))} className="mb-2 text-ink/30 hover:text-red-600" aria-label="Remove education"><Trash2 size={14} /></button></div>
                </div>
              ))}
              {!education.length && <p className="text-sm text-ink/40">No education added yet.</p>}
            </div>
          </section>

          <section className="panel">
            <div className="flex items-center justify-between">
              <h2 className="section-title flex items-center gap-2 !text-xl"><Award size={18} /> Certifications</h2>
              <button type="button" onClick={() => setCertifications((current) => [...current, { key: uid(), name: "", issuer: "" }])} className="chip"><Plus size={13} /> Add certificate</button>
            </div>
            <div className="mt-4 space-y-3">
              {certifications.map((row) => (
                <div key={row.key} className="grid gap-3 rounded-xl border border-ink/10 p-4 md:grid-cols-[1fr_1fr_auto]">
                  <label className="input-label">Certificate<input className="field mt-1.5" value={row.name} onChange={(event) => setCertifications((current) => current.map((entry) => entry.key === row.key ? { ...entry, name: event.target.value } : entry))} /></label>
                  <label className="input-label">Issuer<input className="field mt-1.5" value={row.issuer} onChange={(event) => setCertifications((current) => current.map((entry) => entry.key === row.key ? { ...entry, issuer: event.target.value } : entry))} /></label>
                  <button type="button" onClick={() => setCertifications((current) => current.filter((entry) => entry.key !== row.key))} className="mt-6 text-ink/30 hover:text-red-600" aria-label="Remove certificate"><Trash2 size={14} /></button>
                </div>
              ))}
              {!certifications.length && <p className="text-sm text-ink/40">No certifications added yet.</p>}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button disabled={busy} className="button button-dark"><Save size={15} /> {busy ? "Saving…" : "Save profile"}</button>
            <Link to="/dashboard" className="text-sm text-ink/45 hover:text-ink">Back to dashboard</Link>
            {!resumes.length && <span className="text-xs text-coral">Upload a resume in the sidebar to enable saving.</span>}
          </div>
        </form>

        <aside className="space-y-4">
          <div className="panel">
            <div className="flex items-center justify-between">
              <p className="eyebrow"><FileText size={12} /> Resume</p>
              <span className="text-[10px] uppercase tracking-[.12em] text-ink/30">Required</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-ink/45">PDF or DOCX up to 5 MB. Parsing runs in-process — no external AI key is needed.</p>
            <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} className="button button-outline mt-3 w-full !py-2.5 text-xs">
              <UploadCloud size={14} /> {uploading ? "Processing…" : resumes.length ? "Upload another resume" : "Upload resume"}
            </button>
            <input ref={fileInput} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} />

            <div className="mt-4 space-y-2">
              {resumes.map((resume) => (
                <div key={resume.id} className="rounded-lg border border-ink/10 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{resume.originalName}</p>
                      <p className="mt-0.5 text-[10px] text-ink/40">{resume.status}{resume.status === "PROCESSED" && resume.parsedData?.skills?.length ? ` · ${resume.parsedData.skills.length} skills` : ""} · {formatDate(resume.createdAt)}</p>
                    </div>
                    <button type="button" onClick={() => void removeResume(resume)} aria-label="Delete resume" className="text-ink/25 hover:text-red-600"><Trash2 size={12} /></button>
                  </div>
                  {resume.processingError && <p className="mt-1 text-[10px] leading-4 text-red-600">{resume.processingError}</p>}
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                    {resume.status === "PROCESSED" && <button type="button" onClick={() => void openPreview(resume)} className="text-ink/50 underline underline-offset-2 hover:text-ink">Review extracted fields</button>}
                    {resume.status === "PROCESSED" && <button type="button" onClick={() => void reprocessResume(resume)} disabled={uploading} className="text-ink/50 underline underline-offset-2 hover:text-ink">Reprocess extraction</button>}
                    {resume.status === "FAILED" && <button type="button" onClick={() => void reprocessResume(resume)} disabled={uploading} className="text-coral underline underline-offset-2">Retry parsing</button>}
                    {resume.status === "PROCESSED" && <a href={`/api/v1/me/resumes/${resume.id}/download`} target="_blank" rel="noreferrer" className="text-ink/50 underline underline-offset-2 hover:text-ink">Download</a>}
                  </div>
                </div>
              ))}
              {!resumes.length && <p className="rounded-lg border border-dashed border-ink/15 p-3 text-[11px] leading-5 text-ink/40">No resume uploaded. You can save your profile after the first upload.</p>}
            </div>
          </div>

          <div className="rounded-2xl border border-ink/10 bg-secondary/60 p-5">
            <p className="flex items-center gap-1.5 text-xs font-semibold"><Sparkles size={13} className="text-coral" /> Make it count</p>
            <ul className="mt-3 space-y-2 text-[11px] leading-5 text-ink/50">
              <li className="flex gap-2"><CheckCircle2 size={12} className="mt-0.5 shrink-0 text-[#2f7a56]" /> Use the skill names that appear in job descriptions.</li>
              <li className="flex gap-2"><CheckCircle2 size={12} className="mt-0.5 shrink-0 text-[#2f7a56]" /> Add outcomes to experience, not just responsibilities.</li>
              <li className="flex gap-2"><CheckCircle2 size={12} className="mt-0.5 shrink-0 text-[#2f7a56]" /> Set a realistic salary range to improve preference matching.</li>
            </ul>
          </div>

          <form onSubmit={changePassword} className="panel space-y-3">
            <p className="eyebrow flex items-center gap-1.5"><Lock size={12} /> Account security</p>
            <p className="text-[11px] leading-5 text-ink/45">Changing your password signs you out on every other device. Forgot it instead? <Link to="/reset-password" className="underline underline-offset-2 hover:text-ink">Request a reset link</Link>.</p>
            <label className="input-label">Current password<input className="field mt-1.5" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
            <label className="input-label">New password<input className="field mt-1.5" type="password" autoComplete="new-password" minLength={10} maxLength={128} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
            <label className="input-label">Confirm new password<input className="field mt-1.5" type="password" autoComplete="new-password" minLength={10} maxLength={128} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
            {passwordError && <p role="alert" className="rounded-lg border border-red-300/40 bg-red-50/60 px-3 py-2 text-[11px] text-red-700">{passwordError}</p>}
            {passwordNotice && <p role="status" className="rounded-lg border border-[#2f7a56]/25 bg-[#dff1e8]/60 px-3 py-2 text-[11px] leading-5 text-[#27634e]">{passwordNotice}</p>}
            <button disabled={passwordBusy} className="button button-outline w-full !py-2.5 text-xs">{passwordBusy ? "Updating…" : "Update password"}</button>
          </form>
        </aside>
      </div>

      {preview && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Review extracted resume fields" onClick={() => !busy && setPreview(null)}>
          <div className="modal-panel max-w-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-ink/10 px-6 py-4">
              <div><p className="eyebrow">Resume extraction</p><h2 className="mt-1.5 font-display text-xl font-semibold">Review extracted information</h2></div>
              <button type="button" onClick={() => setPreview(null)} className="grid size-8 place-items-center rounded-full text-ink/40 hover:bg-ink/[.05] hover:text-ink" aria-label="Close"><X size={17} /></button>
            </div>
            <form onSubmit={savePreview} className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
              <p className="text-xs leading-5 text-ink/45">Correct anything the parser got wrong. These fields update your profile and resume record.</p>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="input-label">Name<input className="field mt-2" value={preview.name} onChange={(event) => setPreview({ ...preview, name: event.target.value })} /></label>
                <label className="input-label">Email<input className="field mt-2" value={preview.email} onChange={(event) => setPreview({ ...preview, email: event.target.value })} /></label>
                <label className="input-label">Phone<input className="field mt-2" value={preview.phone} onChange={(event) => setPreview({ ...preview, phone: event.target.value })} /></label>
                <label className="input-label">Location<input className="field mt-2" value={preview.location} onChange={(event) => setPreview({ ...preview, location: event.target.value })} /></label>
                <label className="input-label">Years of experience<input className="field mt-2" type="number" min="0" max="80" value={preview.experienceYears} onChange={(event) => setPreview({ ...preview, experienceYears: event.target.value })} /></label>
                <label className="input-label md:col-span-2">Skills, comma separated<input className="field mt-2" value={preview.skills} onChange={(event) => setPreview({ ...preview, skills: event.target.value })} /></label>
                <label className="input-label md:col-span-2">Professional summary<textarea className="field-lg mt-2 !min-h-24" value={preview.summary} onChange={(event) => setPreview({ ...preview, summary: event.target.value })} /></label>
                <label className="input-label">Education, one per line<textarea className="field-lg mt-2 !min-h-24" value={preview.education} onChange={(event) => setPreview({ ...preview, education: event.target.value })} /></label>
                <label className="input-label">Job titles, one per line<textarea className="field-lg mt-2 !min-h-24" value={preview.jobTitles} onChange={(event) => setPreview({ ...preview, jobTitles: event.target.value })} /></label>
                <label className="input-label">Certifications, one per line<textarea className="field-lg mt-2 !min-h-24" value={preview.certifications} onChange={(event) => setPreview({ ...preview, certifications: event.target.value })} /></label>
                <label className="input-label">Projects, one per line<textarea className="field-lg mt-2 !min-h-24" value={preview.projects} onChange={(event) => setPreview({ ...preview, projects: event.target.value })} /></label>
              </div>
              <div className="flex justify-end gap-2 border-t border-ink/10 pt-4">
                <button type="button" onClick={() => setPreview(null)} className="button button-outline">Cancel</button>
                <button disabled={busy} className="button button-dark">Save corrected details</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
