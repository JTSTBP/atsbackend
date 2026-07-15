const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

// Common technical skills to scan for
const COMMON_SKILLS = [
  "React", "Angular", "Vue", "Node.js", "Node", "Express", "JavaScript", "JS",
  "TypeScript", "TS", "Python", "Java", "SQL", "MongoDB", "PostgreSQL", "HTML",
  "CSS", "AWS", "Docker", "Kubernetes", "Git", "C++", "C#", "PHP", "Ruby",
  "Swift", "Kotlin", "Flutter", "React Native", "Machine Learning", "ML", "AI",
  "Data Science", "Figma", "UI/UX", "Redux", "GraphQL", "Next.js", "Django",
  "Spring Boot", "Hibernate", "Microservices", "REST API", "CI/CD", "Jenkins"
];

// Common design designations to scan for
const COMMON_DESIGNATIONS = [
  "Software Engineer", "Frontend Developer", "Backend Developer", "Full Stack Developer",
  "Software Developer", "Web Developer", "Mobile Developer", "Android Developer",
  "iOS Developer", "DevOps Engineer", "System Administrator", "Database Administrator",
  "QA Engineer", "Quality Analyst", "Automation Engineer", "Test Engineer",
  "Product Manager", "Project Manager", "Scrum Master", "Business Analyst",
  "UI/UX Designer", "Product Designer", "Graphic Designer", "Data Scientist",
  "Data Analyst", "Machine Learning Engineer", "Solutions Architect", "Technical Lead"
];

// Major cities (primarily Indian + international tech hubs) to scan for location
const COMMON_CITIES = [
  "Mumbai", "Pune", "Bengaluru", "Bangalore", "Hyderabad", "Chennai", "Delhi",
  "Noida", "Gurgaon", "Gurugram", "Kolkata", "Ahmedabad", "Jaipur", "Chandigarh",
  "Indore", "Kochi", "Coimbatore", "San Francisco", "New York", "London",
  "Singapore", "Dubai", "Austin", "Seattle"
];

// Degrees to scan for education
const DEGREES = [
  "B.Tech", "B.E.", "M.Tech", "M.E.", "MCA", "BCA", "MBA", "B.Sc", "M.Sc",
  "B.Com", "M.Com", "Ph.D", "Bachelor of Technology", "Bachelor of Engineering",
  "Master of Computer Applications", "Bachelor of Computer Applications",
  "Master of Business Administration", "Bachelor of Science", "Master of Science"
];

/**
 * Extracts raw text from a PDF or DOCX file buffer.
 * @param {Buffer} buffer - File buffer
 * @param {string} mimeType - File mime type or extension
 * @returns {Promise<string>} Extracted text
 */
async function extractTextFromBuffer(buffer, mimeType) {
  console.log("extractTextFromBuffer called. MIME:", mimeType, "buffer size:", buffer.length);
  const isPdf = mimeType === "application/pdf" || mimeType === "pdf";

  if (isPdf) {
    try {
      const data = await pdfParse(buffer);
      const textLength = data.text ? data.text.length : 0;
      console.log("PDF parsing succeeded. Text length:", textLength);
      console.log("PDF text snippet:", data.text ? data.text.substring(0, 200) : "");
      if (textLength > 50) {
        return data.text || "";
      }
      // Fallback to pdfjs if extracted text is too short
      console.warn("pdf-parse returned insufficient text, falling back to pdfjs.");
    } catch (err) {
      console.error("PDF Parsing Error:", err);
    }
    try {
      const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
      const loadingTask = pdfjsLib.getDocument({ data: buffer });
      const pdfDoc = await loadingTask.promise;
      let fullText = '';
      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const strings = textContent.items.map(item => item.str);
        fullText += strings.join(' ') + '\n';
      }
      console.log("pdfjs fallback succeeded. Text length:", fullText.length);
      return fullText;
    } catch (fallbackErr) {
      console.error("pdfjs fallback error:", fallbackErr);
      // Final fallback: return raw buffer as string
      return buffer.toString('utf8');
    }
  } else if (isDocx) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || "";
    } catch (err) {
      console.error("DOCX Parsing Error:", err);
      return buffer.toString("utf8");
    }
  } else {
    // Fallback: attempt to decode as string (useful for plain text/doc files)
    return buffer.toString("utf8").replace(/[^\x20-\x7E\n\r\t]/g, "");
  }
}

/**
 * Heuristically parses details from the resume text.
 * @param {string} text - Raw resume text
 * @returns {Object} Extracted candidate fields
 */
function parseResumeText(text) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  // 1. Extract Email
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const emailMatch = text.match(emailRegex);
  const email = emailMatch ? emailMatch[0] : null;

  // 2. Extract Phone Number
  // Matches typical formats: +91 9999999999, 09999999999, 99999-99999, +1-555-555-5555, etc.
  const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4,6}/g;
  let phone = null;
  const phoneMatches = text.match(phoneRegex);
  if (phoneMatches) {
    // Find the first match that looks like a valid phone number (at least 10 digits/characters)
    for (const match of phoneMatches) {
      const digitsOnly = match.replace(/\D/g, "");
      if (digitsOnly.length >= 10 && digitsOnly.length <= 15) {
        phone = match.trim();
        break;
      }
    }
  }

  // 3. Extract LinkedIn URL
  const linkedinRegex = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/i;
  const linkedinMatch = text.match(linkedinRegex);
  const linkedinProfile = linkedinMatch ? linkedinMatch[0] : null;

  // 4. Extract Name
  // Heuristic: Check the first few lines of the resume.
  // The first line that is short (2-4 words), does not contain numbers, emails, URLs, or typical header words, is likely the name.
  let name = null;
  const excludeWords = [
    "resume", "cv", "curriculum", "vitae", "profile", "summary", "contact",
    "email", "phone", "mobile", "address", "experience", "education", "skills",
    "page", "details", "personal", "github", "linkedin", "portfolio"
  ];
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const line = lines[i];
    const wordCount = line.split(/\s+/).length;
    const hasNumber = /\d/.test(line);
    const hasAt = line.includes("@");
    const hasSlash = line.includes("/") || line.includes("\\");
    const isExcluded = excludeWords.some(word => line.toLowerCase().includes(word));

    if (wordCount >= 2 && wordCount <= 4 && !hasNumber && !hasAt && !hasSlash && !isExcluded) {
      // Basic formatting check: capitalized letters
      const words = line.split(/\s+/);
      const isCapitalized = words.every(word => /^[A-Z]/.test(word) || /^[a-zA-Z]/.test(word));
      if (isCapitalized) {
        name = line;
        break;
      }
    }
  }
  // Fallback: If no name found by heuristic, take the very first non-empty line
  if (!name && lines.length > 0) {
    name = lines[0].substring(0, 50);
  }

  // 5. Extract Skills
  const skills = [];
  const textLower = text.toLowerCase();
  for (const skill of COMMON_SKILLS) {
    const escapedSkill = skill.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    // Boundary match to avoid matching "Java" in "JavaScript" unless specified
    let regex = new RegExp(`\\b${escapedSkill}\\b`, "i");
    if (skill === "C++" || skill === "C#") {
      regex = new RegExp(`${escapedSkill}`, "i");
    }
    if (regex.test(textLower)) {
      skills.push(skill);
    }
  }

  // 6. Extract Location
  let location = null;
  for (const city of COMMON_CITIES) {
    const regex = new RegExp(`\\b${city}\\b`, "i");
    if (regex.test(textLower)) {
      location = city;
      break;
    }
  }
  if (!location) {
    // Try regex patterns like: "Location: Pune" or "Address: Mumbai"
    const locPatterns = [
      /location\s*:\s*([^\n\r,]+)/i,
      /address\s*:\s*([^\n\r,]+)/i,
      /current\s+location\s*:\s*([^\n\r,]+)/i,
      /lives\s+in\s*:\s*([^\n\r,]+)/i
    ];
    for (const pattern of locPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        location = match[1].trim();
        break;
      }
    }
  }

  // 7. Extract Total Experience
  let experience = null;
  const expPatterns = [
    /(\d+(?:\.\d+)?)\s*(?:\+)?\s*(?:years?|yrs?)\s*(?:of\s*)?experience/i,
    /total\s+experience\s*:\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)?/i,
    /experience\s*:\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)?/i
  ];
  for (const pattern of expPatterns) {
    const match = text.match(pattern);
    if (match) {
      const val = parseFloat(match[1]);
      experience = `${val} ${val === 1 ? "year" : "years"}`;
      break;
    }
  }

  // 8. Extract Designation
  let designation = null;
  for (const title of COMMON_DESIGNATIONS) {
    const regex = new RegExp(`\\b${title}\\b`, "i");
    if (regex.test(textLower)) {
      designation = title;
      break;
    }
  }

  // 9. Extract Current & Previous Companies
  // Heuristic: Look for company indicators like "Pvt Ltd", "Ltd", "Inc", "Technologies" or phrases like "at [Company]"
  const companyKeywords = ["Pvt", "Ltd", "Inc", "Technologies", "Solutions", "Corp", "Corporation", "Infosys", "TCS", "Cognizant", "Wipro", "Accenture", "Google", "Microsoft", "Amazon"];
  const previousCompanies = [];
  let currentCompany = null;

  // Search lines for company indicators
  for (const line of lines) {
    const hasCompanyKeyword = companyKeywords.some(keyword => line.toLowerCase().includes(keyword.toLowerCase()));
    const isHeader = line.length < 30 && /experience|work|history|employment/i.test(line);
    if (hasCompanyKeyword && !isHeader) {
      // Extract clean name (often everything before a comma, hyphen or parenthesis)
      const cleanLine = line.split(/[,-]/)[0].trim().substring(0, 100);
      if (cleanLine.length > 3 && !previousCompanies.includes(cleanLine)) {
        previousCompanies.push(cleanLine);
      }
    }
  }

  // Find patterns like "Software Engineer at Google"
  const workingAtRegex = /(?:software engineer|developer|analyst|manager)\s+at\s+([A-Z][A-Za-z0-9\s]+?)(?:\r?\n|Current|,|\.|\(|since)/i;
  const workingAtMatch = text.match(workingAtRegex);
  if (workingAtMatch && workingAtMatch[1]) {
    const comp = workingAtMatch[1].trim();
    if (comp.length > 2 && comp.length < 50) {
      currentCompany = comp;
      if (!previousCompanies.includes(comp)) {
        previousCompanies.unshift(comp); // Add as first
      }
    }
  }

  if (previousCompanies.length > 0 && !currentCompany) {
    currentCompany = previousCompanies[0];
  }

  const prevCompList = previousCompanies.filter(c => c !== currentCompany);

  // 10. Extract Education Details
  const educationDetails = [];
  for (const degree of DEGREES) {
    const regex = new RegExp(`\\b${degree.replace(".", "\\.")}\\b`, "i");
    if (regex.test(textLower)) {
      // Find the line containing the degree to get context
      for (const line of lines) {
        if (regex.test(line)) {
          educationDetails.push(line.substring(0, 120));
          break;
        }
      }
    }
  }
  const education = educationDetails.length > 0 ? educationDetails.join(" | ") : null;

  // 11. Extract Certifications
  const certifications = [];
  const certKeywords = ["Certified", "Certification", "Credential"];
  for (const line of lines) {
    const isCert = certKeywords.some(kw => line.toLowerCase().includes(kw.toLowerCase()));
    const hasSkill = COMMON_SKILLS.some(sk => line.toLowerCase().includes(sk.toLowerCase()));
    if (isCert && line.length < 100 && (hasSkill || line.split(/\s+/).length > 2)) {
      certifications.push(line);
    }
  }

  // 12. Extract Notice Period
  let noticePeriod = null;
  const noticePatterns = [
    /notice\s*period\s*:\s*([^\n\r,]+)/i,
    /notice\s*:\s*([^\n\r,]+)/i,
    /availability\s*:\s*([^\n\r,]+)/i,
    /available\s*to\s*start\s*:\s*([^\n\r,]+)/i
  ];
  for (const pattern of noticePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      noticePeriod = match[1].trim();
      break;
    }
  }
  if (!noticePeriod) {
    const commonNoticeTerms = ["immediate", "15 days", "30 days", "1 month", "2 months", "3 months"];
    for (const term of commonNoticeTerms) {
      if (textLower.includes(term)) {
        noticePeriod = term.charAt(0).toUpperCase() + term.slice(1);
        break;
      }
    }
  }

  // 13. Extract Expected Salary
  let expectedSalary = null;
  const salaryPatterns = [
    /expected\s*ctc\s*:\s*([^\n\r,]+)/i,
    /expected\s*salary\s*:\s*([^\n\r,]+)/i,
    /ctc\s*expected\s*:\s*([^\n\r,]+)/i,
    /ctc\s*:\s*([^\n\r,]+)/i
  ];
  for (const pattern of salaryPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      expectedSalary = match[1].trim();
      break;
    }
  }

  return {
    name,
    email,
    phoneNumber: phone,
    location,
    skills,
    education,
    experience,
    workHistory: previousCompanies.join(", ") || null,
    currentCompany,
    previousCompanies: prevCompList,
    designation,
    certifications: certifications.slice(0, 5), // limit to 5
    linkedinProfile,
    noticePeriod,
    expectedSalary,
    additionalInfo: lines.slice(0, 20).join("\n") // top snippet for debugging
  };
}

module.exports = {
  extractTextFromBuffer,
  parseResumeText
};
