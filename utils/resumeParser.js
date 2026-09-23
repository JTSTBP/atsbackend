const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const path = require("path");

const COMMON_SKILLS = [
  "React", "Angular", "Vue", "Node.js", "Express", "JavaScript", "TypeScript",
  "Python", "Java", "SQL", "MySQL", "MongoDB", "PostgreSQL", "SQLite", "Redis",
  "HTML", "CSS", "SCSS", "SASS", "Bootstrap", "Tailwind",
  "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform",
  "Git", "GitHub", "GitLab", "Bitbucket",
  "C++", "C#", "PHP", "Ruby", "Go", "Golang", "Rust", "Scala", "Kotlin",
  "Swift", "Flutter", "React Native", "Ionic",
  "Machine Learning", "Deep Learning", "AI", "Data Science", "NLP",
  "Figma", "Adobe XD", "UI/UX", "Sketch",
  "Redux", "GraphQL", "REST API", "gRPC", "WebSocket",
  "Next.js", "Nuxt.js", "Django", "Flask", "FastAPI", "Spring Boot",
  "Hibernate", "Microservices", "CI/CD", "Jenkins", "GitHub Actions",
  "Linux", "Bash", "Shell", "PowerShell",
  "Selenium", "Cypress", "Jest", "Mocha", "JUnit", "Pytest",
  "Excel", "Power BI", "Tableau", "Jira", "Confluence",
  "Pandas", "NumPy", "TensorFlow", "PyTorch", "Scikit-learn", "OpenCV"
];

const COMMON_DESIGNATIONS = [
  "Software Engineer", "Senior Software Engineer", "Lead Software Engineer",
  "Frontend Developer", "Backend Developer", "Full Stack Developer",
  "Software Developer", "Web Developer", "Mobile Developer",
  "Android Developer", "iOS Developer",
  "DevOps Engineer", "Site Reliability Engineer",
  "System Administrator", "Database Administrator",
  "QA Engineer", "Quality Analyst", "Automation Engineer", "Test Engineer",
  "Product Manager", "Project Manager", "Scrum Master",
  "Business Analyst", "Technical Lead", "Tech Lead", "Team Lead",
  "Solutions Architect", "Cloud Architect",
  "UI/UX Designer", "Product Designer", "Graphic Designer",
  "Data Scientist", "Data Analyst", "Data Engineer",
  "Machine Learning Engineer", "AI Engineer",
  "Network Engineer", "Security Engineer",
  "React Developer", "Angular Developer", "Node Developer",
  "Java Developer", "Python Developer", "PHP Developer"
];

const COMMON_CITIES = [
  "Mumbai", "Pune", "Bengaluru", "Bangalore", "Hyderabad", "Chennai",
  "Delhi", "New Delhi", "Noida", "Gurgaon", "Gurugram", "Faridabad",
  "Kolkata", "Ahmedabad", "Jaipur", "Chandigarh", "Indore", "Bhopal",
  "Lucknow", "Nagpur", "Kochi", "Coimbatore", "Thiruvananthapuram",
  "Surat", "Vadodara", "Visakhapatnam", "Patna", "Bhubaneswar",
  "San Francisco", "New York", "London", "Singapore", "Dubai", "Austin", "Seattle"
];

const DEGREES = [
  "B.Tech", "B.E", "M.Tech", "M.E", "MCA", "BCA", "MBA", "BBA",
  "B.Sc", "M.Sc", "BSc", "MSc", "B.Com", "M.Com", "BCom", "MCom",
  "Ph.D", "PhD", "Bachelor of Technology", "Bachelor of Engineering",
  "Master of Technology", "Master of Engineering",
  "Master of Computer Applications", "Bachelor of Computer Applications",
  "Master of Business Administration", "Bachelor of Business Administration",
  "Bachelor of Science", "Master of Science"
];

function isPdfMime(mimeType) {
  if (!mimeType) return false;
  const m = mimeType.toLowerCase();
  return m === "application/pdf" || m === "pdf";
}

function isDocxMime(mimeType) {
  if (!mimeType) return false;
  const m = mimeType.toLowerCase();
  return (
    m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    m === "docx" ||
    m === "application/msword" ||
    m === "doc"
  );
}

async function extractTextFromBuffer(buffer, mimeType) {
  // Ensure we always work with a proper Buffer
  if (buffer && !(buffer instanceof Buffer)) {
    buffer = Buffer.from(buffer);
  }

  // Auto-detect from extension if mimeType is missing
  if (!mimeType || mimeType === "application/octet-stream") {
    console.warn("No useful mimeType, falling back to extension from URL");
  }

  console.log("extractTextFromBuffer called. MIME:", mimeType, "buffer size:", buffer ? buffer.length : 0);

  if (isPdfMime(mimeType)) {
    // Primary: pdf-parse (fast, handles most PDFs)
    try {
      const data = await pdfParse(buffer);
      const text = data.text || "";
      console.log("pdf-parse succeeded. Text length:", text.length);
      if (text.trim().length > 50) return text;
      console.warn("pdf-parse returned insufficient text, trying pdfjs-dist fallback.");
    } catch (err) {
      console.error("pdf-parse error:", err.message);
    }

    // Fallback: pdfjs-dist (handles complex/encrypted PDFs)
    try {
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const workerPath = path.resolve(__dirname, "../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `file:///${workerPath.replace(/\\/g, "/")}`;
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      const pdfDoc = await loadingTask.promise;
      let fullText = "";
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map((item) => item.str).join("\n");
        fullText += pageText + "\n";
      }
      console.log("pdfjs-dist fallback succeeded. Text length:", fullText.length);
      if (fullText.trim().length > 50) return fullText;
    } catch (fallbackErr) {
      console.error("pdfjs-dist fallback error:", fallbackErr.message);
    }

    return buffer.toString("utf8");
  }

  if (isDocxMime(mimeType)) {
    try {
      // mammoth needs a proper Buffer, not Uint8Array or ArrayBuffer
      const docxBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      const result = await mammoth.extractRawText({ buffer: docxBuffer });
      const text = result.value || "";
      console.log("mammoth succeeded. Text length:", text.length);
      if (text.trim().length > 0) return text;
      console.warn("mammoth returned empty text");
    } catch (err) {
      console.error("mammoth error:", err.message);
    }
    // Fallback: raw utf8 for doc/rtf
    return buffer.toString("utf8").replace(/[^\x20-\x7E\n\r\t]/g, " ");
  }

  return buffer.toString("utf8").replace(/[^\x20-\x7E\n\r\t]/g, " ");
}

/**
 * Pre-processes raw PDF/DOCX text to normalise it for regex-based extraction.
 * Fixes common issues: missing spaces between words, missing newlines before
 * section headers, camelCase concatenation from multi-column PDFs.
 */
function preprocessText(raw) {
  let text = raw;

  // 1. Normalise Windows line endings
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 2. Insert a space before an uppercase letter that immediately follows a
  //    lowercase letter with no separator, EXCEPT for known camelCase words like JavaScript
  //    This is risky but catches "ExperienceJohn" -> "Experience John".
  //    We'll do a basic replace but then fix known words.
  text = text.replace(/([a-z])([A-Z])/g, "$1 $2");
  text = text.replace(/Java Script/gi, "JavaScript");
  text = text.replace(/Type Script/gi, "TypeScript");
  text = text.replace(/Postgre SQL/gi, "PostgreSQL");
  text = text.replace(/Open CV/gi, "OpenCV");
  text = text.replace(/Node\. js/gi, "Node.js");

  // 3. Force a newline BEFORE common section header keywords so they sit on
  //    their own line and our section-regex can find them.
  const SECTION_HEADERS = [
    "Skills", "Technical Skills", "Key Skills",
    "Experience", "Work Experience", "Professional Experience", "Employment",
    "Education", "Academic Background", "Qualifications",
    "Certifications", "Certificates", "Awards",
    "Projects", "Summary", "Objective", "Profile",
    "Notice Period", "Availability",
    "Languages", "Hobbies", "Interests", "References",
    "Contact", "Personal Details",
  ];
  for (const header of SECTION_HEADERS) {
    const escaped = header.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    // Add newline before the header if it is not already at start of line
    text = text.replace(new RegExp(`([^\n])(${escaped}\\s*[:\n])`, "gi"), "$1\n$2");
  }

  // 4. Collapse 3+ consecutive blank lines to 2
  text = text.replace(/\n{3,}/g, "\n\n");

  // 5. Remove stray bullet/dash chars at the start of lines (replace with nothing)
  text = text.replace(/^[•·▪▸►‣–—\-\*]+\s*/gm, "");

  return text;
}

function parseResumeText(text) {
  if (!text || typeof text !== "string") return emptyResult();

  // Pre-process to normalise raw PDF/DOCX text
  text = preprocessText(text);

  const lines = text.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const textLower = text.toLowerCase();

  // Email — allow + and dots in local part
  const emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0].toLowerCase() : null;

  // Phone — covers +91 9876543210 / 09876543210 / 98765 43210 / (022) 1234 5678
  let phone = null;
  const phoneMatches = text.match(/(?:\+?[\d(][\d\s\-().]{8,20}\d)/g) || [];
  for (const m of phoneMatches) {
    const digits = m.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) { phone = m.trim(); break; }
  }

  // LinkedIn
  const linkedinMatch = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_\-]+(?:\/[a-zA-Z0-9_\-]*)?/i);
  const linkedinProfile = linkedinMatch ? linkedinMatch[0] : null;

  const name        = extractName(lines, email);
  const skills      = extractSkills(text, textLower);
  const location    = extractLocation(text, textLower);
  const experience  = extractExperience(text);
  const designation = extractDesignation(text);
  const { currentCompany, previousCompanies } = extractCompanies(text, lines);
  const education      = extractEducation(text, textLower, lines);
  const certifications = extractCertifications(lines);
  const noticePeriod   = extractNoticePeriod(text, textLower);
  const expectedSalary = extractSalary(text);

  return {
    name, email, phoneNumber: phone, location, skills, education, experience,
    workHistory: previousCompanies.join(", ") || null,
    currentCompany, previousCompanies, designation,
    certifications: certifications.slice(0, 5),
    linkedinProfile, noticePeriod, expectedSalary,
  };
}

function extractName(lines, email) {
  const EXCLUDE = [
    "resume", "cv", "curriculum", "vitae", "profile", "summary", "contact",
    "email", "phone", "mobile", "address", "experience", "education", "skills",
    "page", "details", "personal", "github", "linkedin", "portfolio", "objective",
    "http", "www", "references", "declaration", "career"
  ];
  const emailLocalPart = email ? email.split("@")[0].toLowerCase() : "";

  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    let line = lines[i];
    
    // Strip common prefixes like "Name:" or "Name of Candidate -"
    line = line.replace(/^(?:Name|Name of Candidate)\s*[:\-]\s*/i, "").trim();

    const lower = line.toLowerCase();
    if (line.length > 70) continue;
    if (/\d/.test(line)) continue;                    // has digit
    if (line.includes("@")) continue;                 // email fragment
    if (/[\/\\|<>{}\[\]]/.test(line)) continue;      // special chars (removed : to allow Name:)
    if (EXCLUDE.some((w) => lower.includes(w))) continue;
    if (emailLocalPart && lower.includes(emailLocalPart)) continue;
    
    const words = line.trim().split(/\s+/);
    if (words.length < 1 || words.length > 6) continue;
    
    // Every word must start with a letter (allows initials like A. or O'Brien)
    if (words.every((w) => /^[A-Za-z]/.test(w))) {
      // Bonus: at least one word is Title Case (not all-lowercase)
      if (words.some((w) => /^[A-Z]/.test(w))) return line.trim();
    }
  }
  // Fallback: first non-empty line, capped
  return lines.length > 0 ? lines[0].substring(0, 60).trim() : null;
}

function extractSkills(text, textLower) {
  const found = new Set();

  // Approach A: extract from a dedicated Skills section
  // Matches: "Skills:", "Key Skills:", "Technical Skills:", "Skills\n"
  const sectionRegex = /(?:^|\n)\s*(?:(?:key|technical|core|professional)\s+)?skills?\s*[:\-–]?\s*\n([\s\S]{10,1200}?)(?=\n\s*(?:[A-Z][A-Z\s]{2,}|experience|education|certification|work|employment|project|summary|objective|profile|declaration)\s*[:\n]|$)/im;
  const sectionMatch = text.match(sectionRegex);
  if (sectionMatch && sectionMatch[1]) {
    // Split on newlines, commas, pipes, bullets
    sectionMatch[1]
      .split(/[\n,|/]+/)
      .map((t) => t.replace(/^[\s\-*•►▸]+/, "").trim())
      .filter((t) => t.length > 1 && t.length < 50)
      .forEach((t) => { if (t) found.add(t); });
  }

  // Approach B: keyword list scan across full text
  for (const skill of COMMON_SKILLS) {
    const escaped = skill.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    // Word-boundary match; for skills ending in .js (e.g. Node.js) allow dot
    const regex = skill.endsWith(".js")
      ? new RegExp(`(?<![a-zA-Z])${escaped}(?![a-zA-Z])`, "i")
      : new RegExp(`(?<![a-zA-Z0-9.])${escaped}(?![a-zA-Z0-9.])`, "i");
    if (regex.test(text)) found.add(skill);
  }

  return [...found].slice(0, 35);
}

function extractLocation(text, textLower) {
  for (const pattern of [
    /current\s*location\s*[:\-]\s*([^\n\r,|]{2,60})/i,
    /location\s*[:\-]\s*([^\n\r,|]{2,60})/i,
    /address\s*[:\-]\s*([^\n\r,|]{2,60})/i,
    /city\s*[:\-]\s*([^\n\r,|]{2,60})/i,
    /residence\s*[:\-]\s*([^\n\r,|]{2,60})/i,
  ]) {
    const m = text.match(pattern);
    if (m && m[1]) return m[1].trim().substring(0, 60);
  }
  for (const city of COMMON_CITIES) {
    if (new RegExp(`\\b${city}\\b`, "i").test(textLower)) return city;
  }
  return null;
}

function extractExperience(text) {
  const patterns = [
    // "5+ years of experience" / "5.5 yrs experience"
    /(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:total\s+)?(?:work\s+)?experience/i,
    // "Total Experience: 5 years"
    /total\s+(?:work\s+)?(?:experience|exp)\s*[:\-–]\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)?/i,
    // "Experience: 5 years" / "Exp: 5 yrs"
    /(?:experience|exp)\s*[:\-–]\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/i,
    // "5 years of experience"
    /(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\s+(?:of\s+)?experience/i,
    // "5+ yrs"
    /(\d+(?:\.\d+)?)\s*\+\s*(?:years?|yrs?)/i,
    // "Experience in years: 5"
    /experience\s+in\s+years?\s*[:\-–]\s*(\d+(?:\.\d+)?)/i,
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m && m[1]) {
      const val = parseFloat(m[1]);
      if (!isNaN(val) && val >= 0 && val <= 60) return `${val} ${val === 1 ? "year" : "years"}`;
    }
  }
  return null;
}

function extractDesignation(text) {
  const sorted = [...COMMON_DESIGNATIONS].sort((a, b) => b.length - a.length);
  for (const title of sorted) {
    const escaped = title.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) return title;
  }
  return null;
}

function extractCompanies(text, lines) {
  const keywords = [
    "Pvt", "Ltd", "Limited", "Inc", "Corp", "Corporation",
    "Technologies", "Technology", "Solutions", "Services", "Systems",
    "Consulting", "Consultancy", "Software", "Infotech",
    "Infosys", "TCS", "Cognizant", "Wipro", "Accenture", "HCL",
    "Google", "Microsoft", "Amazon", "Meta", "Apple", "IBM", "Oracle",
    "Capgemini", "Deloitte", "Salesforce"
  ];
  const companies = [];
  let currentCompany = null;

  const labelMatch = text.match(/(?:current\s+)?(?:company|employer|organization|firm)\s*[:\-]\s*([^\n\r,|]{3,60})/i);
  if (labelMatch && labelMatch[1]) {
    const c = labelMatch[1].trim();
    currentCompany = c;
    companies.push(c);
  }

  const atRegex = /(?:working|worked|employed)\s+(?:as\s+\S+\s+)?at\s+([A-Z][A-Za-z0-9\s&.]+?)(?:\s*[,\n\r.(]|$)/gm;
  let atMatch;
  while ((atMatch = atRegex.exec(text)) !== null) {
    const c = atMatch[1].trim();
    if (c.length > 2 && c.length < 60 && !companies.includes(c)) {
      if (!currentCompany) currentCompany = c;
      companies.push(c);
    }
  }

  for (const line of lines) {
    if (line.length > 120) continue;
    if (/experience|work|history|employment/i.test(line) && line.length < 35) continue;
    if (keywords.some((kw) => new RegExp(`\\b${kw}\\b`, "i").test(line))) {
      // Split by comma, dash, pipe, OR opening parenthesis
      const clean = line.split(/[,\-|(]/)[0].trim().substring(0, 80);
      if (clean.length > 3 && !companies.includes(clean)) {
        companies.push(clean);
        if (!currentCompany) currentCompany = clean;
      }
    }
  }
  return { currentCompany, previousCompanies: companies.filter((c) => c !== currentCompany) };
}

function extractEducation(text, textLower, lines) {
  const found = [];
  for (const degree of DEGREES) {
    const escaped = degree.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`(?<![a-zA-Z])${escaped}(?![a-zA-Z])`, "i");
    if (regex.test(textLower)) {
      for (const line of lines) {
        if (regex.test(line.toLowerCase())) {
          const entry = line.trim().substring(0, 150);
          if (!found.some((e) => e.includes(degree))) found.push(entry);
          break;
        }
      }
    }
  }
  return found.length > 0 ? found.join(" | ") : null;
}

function extractCertifications(lines) {
  const kws = ["certified", "certification", "certificate", "credential"];
  return lines.filter((l) => kws.some((kw) => l.toLowerCase().includes(kw)) && l.length < 150 && l.split(/\s+/).length > 2).map((l) => l.trim());
}

function extractNoticePeriod(text, textLower) {
  for (const pattern of [
    /notice\s*period\s*[:\-]\s*([^\n\r,|]{1,40})/i,
    /notice\s*[:\-]\s*([^\n\r,|]{1,40})/i,
    /availability\s*[:\-]\s*([^\n\r,|]{1,40})/i,
    /joining\s*(?:time|period)\s*[:\-]\s*([^\n\r,|]{1,40})/i,
  ]) {
    const m = text.match(pattern);
    if (m && m[1]) return m[1].trim();
  }
  for (const term of ["immediate joiner", "immediate", "15 days", "30 days", "45 days", "60 days", "90 days", "1 month", "2 months", "3 months", "6 months", "serving notice"]) {
    if (textLower.includes(term)) return term.charAt(0).toUpperCase() + term.slice(1);
  }
  return null;
}

function extractSalary(text) {
  for (const pattern of [
    /expected\s*ctc\s*[:\-]\s*([^\n\r,|]{1,40})/i,
    /expected\s*salary\s*[:\-]\s*([^\n\r,|]{1,40})/i,
    /current\s*ctc\s*[:\-]\s*([^\n\r,|]{1,40})/i,
    /ctc\s*expected\s*[:\-]\s*([^\n\r,|]{1,40})/i,
    /ctc\s*[:\-]\s*([^\n\r,|]{1,40})/i,
    /annual\s*(?:package|salary|ctc)\s*[:\-]\s*([^\n\r,|]{1,40})/i,
  ]) {
    const m = text.match(pattern);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function emptyResult() {
  return {
    name: null, email: null, phoneNumber: null, location: null, skills: [],
    education: null, experience: null, workHistory: null, currentCompany: null,
    previousCompanies: [], designation: null, certifications: [],
    linkedinProfile: null, noticePeriod: null, expectedSalary: null
  };
}

module.exports = { extractTextFromBuffer, parseResumeText };
