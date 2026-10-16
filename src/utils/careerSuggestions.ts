/**
 * Rule-based career suggestions from a user's own profile. No job data source is used:
 * results are general career paths, never job openings, and the UI labels them as such.
 */

export interface CareerProfile {
  skills: readonly string[];
  jobTitle?: string | null;
  experience?: string | null;
  education?: string | null;
  /** Names/objectives of projects the user worked on. */
  projects?: readonly string[];
}

export interface CareerSuggestion {
  title: string;
  /** Short description of the path. */
  path: string;
  industries: string[];
  markets: string[];
  /** Core skills of this path the user already lists. */
  matchedSkills: string[];
  /** Core skills of this path the user doesn't list yet. */
  skillGaps: string[];
  /** Why it was suggested (which profile data matched). */
  reasons: string[];
  score: number;
}

interface CareerPath {
  title: string;
  path: string;
  keywords: string[];
  coreSkills: string[];
  industries: string[];
  markets: string[];
}

const CATALOG: readonly CareerPath[] = [
  {
    title: "Cloud Security Engineer",
    path: "Secure cloud platforms, identities and infrastructure as code.",
    keywords: ["aws", "azure", "gcp", "cloud", "iam", "kubernetes", "terraform", "identity"],
    coreSkills: ["AWS security", "IAM", "Infrastructure as Code", "Kubernetes security"],
    industries: ["Cloud & SaaS", "Fintech", "E-commerce"],
    markets: ["Europe", "North America", "Remote-first companies"],
  },
  {
    title: "SOC / Security Analyst",
    path: "Monitor, detect and triage security alerts in a security operations centre.",
    keywords: ["siem", "soc", "monitoring", "log", "splunk", "sentinel", "alert", "detection", "analyst"],
    coreSkills: ["SIEM", "Incident response", "Threat hunting", "Log analysis"],
    industries: ["Managed security services (MSSP)", "Banking", "Telecommunications"],
    markets: ["Morocco & North Africa", "Europe", "Gulf countries"],
  },
  {
    title: "Penetration Tester",
    path: "Find and report vulnerabilities in applications, networks and cloud environments.",
    keywords: ["pentest", "penetration", "ethical hacking", "burp", "owasp", "vulnerability", "red team", "exploit"],
    coreSkills: ["Pentest", "Vulnerability management", "OWASP Top 10", "Reporting"],
    industries: ["Cybersecurity consulting", "Fintech", "Public sector"],
    markets: ["Europe", "North America", "Morocco & North Africa"],
  },
  {
    title: "GRC / Compliance Consultant",
    path: "Run risk assessments, audits and compliance programmes.",
    keywords: ["iso 27001", "grc", "risk", "audit", "compliance", "gdpr", "nis2", "policy", "governance"],
    coreSkills: ["ISO 27001", "GRC", "Risk assessment", "Audit"],
    industries: ["Consulting", "Banking & insurance", "Healthcare"],
    markets: ["Europe", "Morocco & North Africa", "Gulf countries"],
  },
  {
    title: "Incident Response / DFIR Specialist",
    path: "Lead investigations, containment and recovery after security incidents.",
    keywords: ["incident", "forensic", "dfir", "malware", "breach", "containment"],
    coreSkills: ["Incident response", "Digital forensics", "Malware analysis", "Crisis communication"],
    industries: ["Managed security services (MSSP)", "Critical infrastructure", "Consulting"],
    markets: ["Europe", "North America", "Gulf countries"],
  },
  {
    title: "DevSecOps Engineer",
    path: "Build security into CI/CD pipelines, containers and developer workflows.",
    keywords: ["devops", "devsecops", "ci/cd", "pipeline", "docker", "kubernetes", "terraform", "git", "sast"],
    coreSkills: ["CI/CD security", "SAST/DAST", "Container security", "Infrastructure as Code"],
    industries: ["Software & SaaS", "Fintech", "Telecommunications"],
    markets: ["Europe", "North America", "Remote-first companies"],
  },
  {
    title: "Security Project / Programme Manager",
    path: "Plan and deliver security projects across teams, budgets and clients.",
    keywords: ["project management", "project manager", "reporting", "planning", "pmp", "prince2", "agile", "scrum", "stakeholder"],
    coreSkills: ["Project management", "Reporting", "Risk management", "Stakeholder management"],
    industries: ["Consulting", "Banking", "Public sector"],
    markets: ["Morocco & North Africa", "Europe", "Gulf countries"],
  },
  {
    title: "Security Architect",
    path: "Design secure architectures and guide technical security decisions.",
    keywords: ["architect", "architecture", "zero trust", "design", "network", "threat model"],
    coreSkills: ["Zero Trust architecture", "Threat modeling", "Network security", "Cloud architecture"],
    industries: ["Enterprise IT", "Banking", "Cloud & SaaS"],
    markets: ["Europe", "North America", "Gulf countries"],
  },
  {
    title: "Data Protection / Privacy Specialist",
    path: "Manage personal-data compliance, privacy impact assessments and data governance.",
    keywords: ["gdpr", "privacy", "dpo", "data protection", "personal data", "cndp"],
    coreSkills: ["GDPR", "Privacy impact assessment", "Data governance", "Audit"],
    industries: ["Healthcare", "Banking & insurance", "E-commerce"],
    markets: ["Europe", "Morocco & North Africa"],
  },
];

const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
const contains = (text: string, keyword: string) => text.includes(norm(keyword));

/**
 * Ranks career paths for a profile. Skills and job title weigh more than free text
 * (experience, education, projects). Returns at most `limit` paths with at least one match.
 */
export function suggestCareers(profile: CareerProfile, limit = 3): CareerSuggestion[] {
  const skills = profile.skills.map(norm).filter(Boolean);
  const title = norm(profile.jobTitle ?? "");
  const freeText = norm([profile.experience, profile.education, ...(profile.projects ?? [])].filter(Boolean).join(" "));
  if (!skills.length && !title && !freeText) return [];

  return CATALOG.map((path) => {
    const reasons: string[] = [];
    let score = 0;
    const skillHits = path.keywords.filter((k) => skills.some((s) => contains(s, k) || contains(k, s)));
    if (skillHits.length) {
      score += 2 * skillHits.length;
      reasons.push(`skills (${skillHits.join(", ")})`);
    }
    if (path.keywords.some((k) => contains(title, k))) {
      score += 2;
      reasons.push(`job title “${profile.jobTitle}”`);
    }
    const textHits = path.keywords.filter((k) => contains(freeText, k));
    if (textHits.length) {
      score += textHits.length;
      reasons.push(`experience, education or projects (${textHits.join(", ")})`);
    }
    const has = (skill: string) => skills.some((s) => s === norm(skill) || contains(s, skill) || contains(norm(skill), s));
    return {
      title: path.title,
      path: path.path,
      industries: path.industries,
      markets: path.markets,
      matchedSkills: path.coreSkills.filter(has),
      skillGaps: path.coreSkills.filter((skill) => !has(skill)),
      reasons,
      score,
    };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.skillGaps.length - b.skillGaps.length || a.title.localeCompare(b.title))
    .slice(0, limit);
}
