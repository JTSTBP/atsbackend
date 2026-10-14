const express = require("express");
const mongoose = require("mongoose");
const Job = require("../models/Jobs");
const SourcedCandidate = require("../models/SourcedCandidate");
const CandidateByJob = require("../models/CandidatesByJob");
const CallLog = require("../models/CallLog");
const FollowUp = require("../models/FollowUp");
const Communication = require("../models/Communication");
const CommunicationTemplate = require("../models/CommunicationTemplate");
const ActivityLog = require("../models/activitylog");
const upload = require("../middleware/upload");
const { protect } = require("../middleware/authMiddleware");
const logActivity = require("./logactivity");
const { formatEmailErrorResponse } = require("../services/emailService");
const { getUserEmailOptions, sendUserMail } = require("../services/userEmailService");
const { sendWhatsAppMessage } = require("../services/whatsappService");
const { runEmailSequenceWorkerOnce, scheduleForStep } = require("../services/emailSequenceWorker");
const { getLineupForm, validateLineupFields } = require("../services/lineupConversion");
const { getSignedUrl } = require("../config/s3Config");

const router = express.Router();

const EMAIL_CATEGORIES = [
  "No Answer",
  "Call Back",
  "Job Opportunity",
  "JD Sharing",
  "Interested Candidate",
  "Interview Reminder",
  "Interview Follow-up",
  "Offer Follow-up",
  "Joining Reminder",
  "Custom",
];

const WHATSAPP_CATEGORIES = [
  "No Answer",
  "Job Opportunity",
  "JD Sharing",
  "Call Back",
  "Interview Reminder",
  "Follow-up",
  "Joining Reminder",
  "Custom",
];

const requireRecruiter = (req, res, next) => {
  if (!req.user || req.user.isDisabled) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  if (!["Recruiter", "Admin", "Manager"].includes(req.user.designation)) {
    return res.status(403).json({ success: false, message: "Not allowed" });
  }
  next();
};

router.use(protect, requireRecruiter);

const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toId = (value) => String(value?._id || value || "");
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const canSeeAllFollowUps = (user) => ["Admin", "Manager"].includes(user?.designation);
const ownerScope = (req) => canSeeAllFollowUps(req.user) ? {} : { recruiterId: req.user._id };

const getCandidateField = (candidate, keys) => {
  for (const key of keys) {
    if (candidate?.[key] !== undefined && candidate?.[key] !== null && String(candidate[key]).trim() !== "") {
      return String(candidate[key]).trim();
    }
  }
  const fields = candidate?.dynamicFields || {};
  for (const key of keys) {
    if (fields[key] !== undefined && fields[key] !== null && String(fields[key]).trim() !== "") {
      return String(fields[key]).trim();
    }
  }
  return "";
};

const formatLocation = (location) => {
  if (!location) return "";
  if (Array.isArray(location)) return location.map((item) => item?.name || item).filter(Boolean).join(", ");
  if (typeof location === "object") return location.name || "";
  return String(location);
};

const formatSalary = (salary) => {
  if (!salary) return "";
  const min = salary.min || "";
  const max = salary.max || "";
  const currency = salary.currency || "";
  return [currency, [min, max].filter(Boolean).join(" - ")].filter(Boolean).join(" ");
};

const formatExperience = (experience) => {
  if (!experience) return "";
  const range = [experience.min, experience.max].filter(Boolean).join(" - ");
  return range ? `${range} ${experience.unit || "years"}` : "";
};

const recruiterJobQuery = (user) => {
  if (user.designation === "Admin" || user.designation === "Manager") return {};
  return {
    $or: [
      { assignedRecruiters: user._id },
      { leadRecruiter: user._id },
    ],
  };
};

const assertJobAccess = async (req, jobId) => {
  if (!isObjectId(jobId)) return null;
  const job = await Job.findOne({ _id: jobId, ...recruiterJobQuery(req.user) })
    .populate("clientId", "companyName name clientName")
    .lean();
  return job;
};

const assertCandidateAccess = async (req, candidateId) => {
  if (!isObjectId(candidateId)) return { candidate: null, job: null };
  const candidate = await SourcedCandidate.findOne({ _id: candidateId, ...ownerScope(req) })
    .populate({
      path: "requirementId",
      populate: { path: "clientId", select: "companyName name clientName" },
    })
    .populate("recruiterId", "name email designation")
    .lean();
  if (!candidate || !candidate.requirementId) return { candidate: null, job: null };
  const job = await assertJobAccess(req, candidate.requirementId._id || candidate.requirementId);
  if (!job) return { candidate: null, job: null };
  return { candidate, job };
};

const buildCandidateSummary = (candidate, extras = {}) => ({
  _id: candidate._id,
  name: getCandidateField(candidate, ["name", "candidateName", "CandidateName", "Name"]) || "Unnamed Candidate",
  email: getCandidateField(candidate, ["Email", "email"]),
  phone: getCandidateField(candidate, ["phoneNumber", "Phone", "phone", "Mobile", "mobile"]),
  experience: getCandidateField(candidate, ["Experience", "experience", "totalExperience"]),
  currentCompany: getCandidateField(candidate, ["Current Company", "currentCompany", "company"]),
  resumeUrl: getSignedUrl(candidate.resumeFileUrl || candidate.resumeUrl),
  status: candidate.status || "Sourced",
  createdAt: candidate.createdAt,
  recruiterId: candidate.recruiterId?._id || candidate.recruiterId,
  addedBy: candidate.recruiterId ? {
    _id: candidate.recruiterId._id || candidate.recruiterId,
    name: candidate.recruiterId.name || "Unknown User",
    email: candidate.recruiterId.email || "",
    designation: candidate.recruiterId.designation || "",
  } : null,
  isDuplicate: candidate.isDuplicate || false,
  originalCandidateId: candidate.originalCandidateId || null,
  ...extras,
});

const buildPhoneRegex = (phoneStr) => {
  if (!phoneStr) return null;
  const digits = String(phoneStr).replace(/\D/g, "");
  if (digits.length >= 10) {
    return new RegExp(`${digits.slice(-10).split("").join("\\D*")}\\D*$`);
  }
  return new RegExp(escapeRegex(String(phoneStr).trim()), "i");
};

const buildCandidateMatchConditions = (email, phone) => {
  const or = [];
  const cleanEmail = String(email || "").trim();
  if (cleanEmail) {
    or.push({ email: new RegExp(`^${escapeRegex(cleanEmail)}$`, "i") });
  }
  const phoneRegex = buildPhoneRegex(phone);
  if (phoneRegex) {
    or.push({ phoneNumber: phoneRegex });
  }
  return or;
};

const getCandidateAdditionBlock = async (req, job, email, phone, checkOwnSource = true, excludeCandidateId = null) => {
  const jobId = job._id;
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanPhone = String(phone || "").replace(/\D/g, "");
  const phoneKey = value => {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length >= 10 ? digits.slice(-10) : digits;
  };
  // Normal candidate fields are configurable: labels, casing and field IDs vary by job.
  const definitions = new Map();
  (job.candidateFields || []).forEach(field => {
    const name = String(field.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const kind = field.type === "email" || name.includes("email") ? "email"
      : field.type === "tel" || /phone|mobile|contactnumber/.test(name) ? "phone" : "";
    if (kind) {
      definitions.set(field.name, kind);
      if (field.id) definitions.set(field.id, kind);
    }
  });
  const normalCandidates = await CandidateByJob.find({ jobId }).select("dynamicFields").lean();
  const isNormalDuplicate = normalCandidates.some(candidate => Object.entries(candidate.dynamicFields || {}).some(([key, value]) => {
    const name = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const kind = definitions.get(key) || (name.includes("email") ? "email" : /phone|mobile|contactnumber/.test(name) ? "phone" : "");
    const values = Array.isArray(value) ? value : [value];
    return values.some(item => kind === "email" ? Boolean(cleanEmail) && String(item ?? "").trim().toLowerCase() === cleanEmail
      : kind === "phone" && Boolean(cleanPhone) && phoneKey(item) === phoneKey(cleanPhone));
  }));
  if (isNormalDuplicate) {
    return { canAdd: false, duplicateSource: "normal", message: "Duplicate: this profile already exists in this requirement's candidates list and cannot be added again." };
  }
  const sourceMatches = buildCandidateMatchConditions(email, phone);
  if (checkOwnSource && req.user.designation === "Recruiter" && sourceMatches.length && await SourcedCandidate.exists({ requirementId: jobId, recruiterId: req.user._id, ...(excludeCandidateId ? { _id: { $ne: excludeCandidateId } } : {}), $or: sourceMatches })) {
    return { canAdd: false, duplicateSource: "own_source", message: "You have already added this profile to this requirement." };
  }
  return { canAdd: true };
};

const normalizeWhatsAppPhone = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) digits = `91${digits.slice(1)}`;
  return digits;
};

const buildWhatsAppUrl = (phone, body = "") => {
  const normalizedPhone = normalizeWhatsAppPhone(phone);
  if (!normalizedPhone) return "";
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(String(body || ""))}`;
};

const buildJobSummary = (job, counts = {}) => ({
  _id: job._id,
  title: job.title,
  company: job.clientId?.companyName || job.clientId?.clientName || job.clientId?.name || "N/A",
  location: formatLocation(job.location),
  experience: formatExperience(job.experience),
  salary: formatSalary(job.salary),
  employmentType: job.employmentType,
  keySkills: job.keySkills || [],
  noOfPositions: job.noOfPositions || 0,
  status: job.status,
  candidateCount: counts.candidateCount ?? job.candidateCount ?? 0,
  pendingFollowUpsCount: counts.pendingFollowUpsCount || 0,
  createdAt: job.createdAt,
});

const templateVariables = (candidate, job, recruiter, extras = {}) => ({
  candidateName: getCandidateField(candidate, ["name", "candidateName", "CandidateName", "Name"]) || "Candidate",
  jobTitle: job?.title || "the role",
  companyName: job?.clientId?.companyName || job?.clientId?.clientName || job?.clientId?.name || "our client",
  location: formatLocation(job?.location) || "the mentioned location",
  recruiterName: recruiter?.name || "Recruitment Team",
  experience: getCandidateField(candidate, ["Experience", "experience", "totalExperience"]),
  salary: formatSalary(job?.salary),
  interviewDate: extras.interviewDate || "",
  joiningDate: extras.joiningDate || "",
});

const renderTemplate = (text, variables) => String(text || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
  const profileNameKeys = ["candidateName", "profileName", "name"];
  return profileNameKeys.includes(key) ? variables.candidateName || "Candidate" : variables[key] || "";
});

const escapeHtml = (value = "") => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const getPublicBaseUrl = () => {
  const configured = process.env.PUBLIC_BASE_URL || process.env.BACKEND_PUBLIC_URL || process.env.APP_URL || process.env.FRONTEND_URL || "";
  return String(configured).replace(/\/$/, "");
};

const getCompanyLogoUrl = () => {
  const explicitLogo = process.env.COMPANY_LOGO_URL || process.env.EMAIL_LOGO_URL || "";
  if (explicitLogo) return explicitLogo;
  const baseUrl = getPublicBaseUrl();
  return baseUrl ? `${baseUrl}/uploads/logos/logo-1772087065032-examle.jpg` : "";
};

const toPlainText = (paragraphs) => paragraphs.filter(Boolean).join("\n\n");

const buildEmailHtml = ({ subject, eyebrow, paragraphs, ctaText, signatureName, vars }) => {
  const logoUrl = getCompanyLogoUrl();
  const safeSubject = escapeHtml(subject);
  const safeEyebrow = escapeHtml(eyebrow || "Recruitment Follow-up");
  const details = [
    ["Role", vars.jobTitle],
    ["Company", vars.companyName],
    ["Location", vars.location],
    ["Experience", vars.experience],
    ["Compensation", vars.salary],
  ].filter(([, value]) => value);

  return `
    <div style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f4f7fb;padding:24px 0;">
        <tr>
          <td align="center" style="padding:24px 12px;">
            <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;border-collapse:collapse;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 18px 40px rgba(15,23,42,0.08);">
              <tr>
                <td style="background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 58%,#0f766e 100%);padding:26px 30px;color:#ffffff;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                    <tr>
                      <td style="vertical-align:middle;">
                        ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="Jobs Territory" width="148" style="display:block;max-width:148px;height:auto;background:#ffffff;border-radius:10px;padding:8px;" />` : `<div style="font-size:22px;font-weight:800;letter-spacing:.3px;">Jobs Territory</div>`}
                      </td>
                      <td align="right" style="vertical-align:middle;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#dbeafe;">
                        ${safeEyebrow}
                      </td>
                    </tr>
                  </table>
                  <h1 style="margin:26px 0 0;font-size:28px;line-height:1.2;font-weight:800;color:#ffffff;">${safeSubject}</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:30px;">
                  ${paragraphs.map((paragraph) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#334155;">${escapeHtml(paragraph).replace(/\n/g, "<br/>")}</p>`).join("")}
                  ${details.length ? `
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:22px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
                      ${details.map(([label, value]) => `
                        <tr>
                          <td style="width:34%;padding:12px 16px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#64748b;">${escapeHtml(label)}</td>
                          <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:700;color:#0f172a;">${escapeHtml(value)}</td>
                        </tr>
                      `).join("")}
                    </table>
                  ` : ""}
                  ${ctaText ? `<div style="margin:24px 0;"><span style="display:inline-block;background:#2563eb;color:#ffffff;border-radius:10px;padding:12px 18px;font-size:14px;font-weight:800;">${escapeHtml(ctaText)}</span></div>` : ""}
                  <p style="margin:24px 0 0;font-size:15px;line-height:1.7;color:#334155;">Regards,<br/><strong>${escapeHtml(signatureName)}</strong><br/><span style="color:#64748b;">Jobs Territory Recruitment Team</span></p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
};

const makeEmailTemplate = ({ label, subject, eyebrow, paragraphs, ctaText, vars }) => ({
  label,
  subject,
  body: toPlainText([...paragraphs, `Regards,\n${vars.recruiterName}\nJobs Territory Recruitment Team`]),
  htmlBody: buildEmailHtml({ subject, eyebrow, paragraphs, ctaText, signatureName: vars.recruiterName, vars }),
});

const makeGeneratedTemplates = (channel, category, candidate, job, recruiter) => {
  const vars = templateVariables(candidate, job, recruiter);
  const baseSubject = `${vars.jobTitle} opportunity - ${vars.companyName}`;
  if (channel === "EMAIL") {
    const noAnswer = category === "No Answer";
    const callback = category === "Call Back";
    return [
      makeEmailTemplate({
        label: "Professional Branded",
        subject: noAnswer ? `Following up on the ${vars.jobTitle} opportunity` : baseSubject,
        eyebrow: "Opportunity Follow-up",
        ctaText: "Reply with your availability",
        vars,
        paragraphs: [
          `Hi ${vars.candidateName},`,
          noAnswer
            ? `I tried reaching you regarding the ${vars.jobTitle} opportunity with ${vars.companyName}. I wanted to share the key details and understand whether this role aligns with your current career plans.`
            : `We are working on a ${vars.jobTitle} opportunity with ${vars.companyName}, and your profile looks relevant for the requirement.`,
          `Please share a convenient time for a brief discussion. I will walk you through the role, expectations, location, compensation details and next steps.`,
        ],
      }),
      makeEmailTemplate({
        label: "Executive Summary",
        subject: `Role details for ${vars.jobTitle} - ${vars.companyName}`,
        eyebrow: "Role Snapshot",
        ctaText: "Confirm interest",
        vars,
        paragraphs: [
          `Hello ${vars.candidateName},`,
          `Sharing a concise overview of the ${vars.jobTitle} opening with ${vars.companyName}. Based on the available information, this could be a strong fit for your background.`,
          callback
            ? `As discussed, please confirm a suitable time to reconnect so we can take this forward without delay.`
            : `If you are open to exploring this opportunity, please reply with your updated availability and any key expectations we should keep in mind.`,
        ],
      }),
      makeEmailTemplate({
        label: "Warm Follow-up",
        subject: `Can we connect about ${vars.jobTitle}?`,
        eyebrow: "Candidate Connect",
        ctaText: "Schedule a quick call",
        vars,
        paragraphs: [
          `Hi ${vars.candidateName},`,
          `Hope you are doing well. I am reaching out from Jobs Territory about a ${vars.jobTitle} opening with ${vars.companyName}.`,
          `I would be happy to share the complete job description and answer any questions you may have. Please let me know when you would be comfortable speaking for a few minutes.`,
        ],
      }),
    ];
  }

  return [
    {
      label: "Short",
      body: `Hi ${vars.candidateName}, we tried reaching you regarding the ${vars.jobTitle} opportunity. Please let us know a convenient time to connect.`,
    },
    {
      label: "Detailed",
      body: `Hi ${vars.candidateName}, this is ${vars.recruiterName} from Jobs Territory. We have a ${vars.jobTitle} opening with ${vars.companyName} in ${vars.location}. Please reply if you are interested.`,
    },
    {
      label: "Reminder",
      body: `Hello ${vars.candidateName}, gentle reminder about the ${vars.jobTitle} opportunity. Please share your availability for a quick discussion.`,
    },
  ];
};

const makeDraftStudioTemplates = (candidate, job, recruiter) => {
  const vars = templateVariables(candidate, job, recruiter);
  const steps = [
    {
      label: "Email 1 - Introduction",
      subject: `${vars.jobTitle} opportunity with ${vars.companyName}`,
      eyebrow: "Opportunity Introduction",
      ctaText: "Reply with availability",
      paragraphs: [
        `Hi ${vars.candidateName},`,
        `I am reaching out from Jobs Territory about a ${vars.jobTitle} opportunity with ${vars.companyName}. Your profile appears relevant for the requirement, and I wanted to check whether you are open to exploring a new role.`,
        `Please reply with a suitable time for a short conversation so I can share the role details, expectations and next steps.`,
      ],
    },
    {
      label: "Email 2 - Role Context",
      subject: `More context on the ${vars.jobTitle} role`,
      eyebrow: "Role Context",
      ctaText: "Share your interest",
      paragraphs: [
        `Hi ${vars.candidateName},`,
        `Following up with a little more context on the ${vars.jobTitle} opening. The role is connected to ${vars.companyName}${vars.location ? ` in ${vars.location}` : ""}, and we are aligning candidates based on experience, skills and availability.`,
        `If this sounds relevant, please share your current availability and any expectations you would like us to keep in mind.`,
      ],
    },
    {
      label: "Email 3 - Recruiter Support",
      subject: `Can I help with details for ${vars.jobTitle}?`,
      eyebrow: "Recruiter Support",
      ctaText: "Ask a question",
      paragraphs: [
        `Hello ${vars.candidateName},`,
        `I wanted to make it easy for you to evaluate the ${vars.jobTitle} opportunity. I can walk you through the job description, interview process, compensation range and work location before you decide.`,
        `Please let me know what information would help you assess the opportunity better.`,
      ],
    },
    {
      label: "Email 4 - Availability Check",
      subject: `Checking your availability for a quick discussion`,
      eyebrow: "Availability Check",
      ctaText: "Confirm a time",
      paragraphs: [
        `Hi ${vars.candidateName},`,
        `Just checking whether you had a chance to review my earlier notes about the ${vars.jobTitle} role with ${vars.companyName}.`,
        `If you are interested, please send a convenient time today or tomorrow. If not, a short reply is completely fine and I will update our records accordingly.`,
      ],
    },
    {
      label: "Email 5 - Close the Loop",
      subject: `Should I close this for now?`,
      eyebrow: "Closing Follow-up",
      ctaText: "Reply if interested",
      paragraphs: [
        `Hi ${vars.candidateName},`,
        `I have not been able to connect with you regarding the ${vars.jobTitle} opportunity, so I will close the loop for now.`,
        `If you would like to revisit this role or hear about similar opportunities later, please reply and I will be happy to help.`,
      ],
    },
  ];
  return steps.map((step, index) => ({
    ...makeEmailTemplate({ ...step, vars }),
    step: index,
  }));
};

const sendEmailCommunication = async ({ communication, recruiter, recipient, subject, body, htmlBody }) => {
  const result = await sendUserMail(recruiter._id, {
    to: recipient,
    subject,
    html: htmlBody || body.replace(/\n/g, "<br/>"),
    text: body,
  });
  communication.status = "sent";
  communication.providerMessageId = result.messageId || result.traceId;
  communication.sentAt = new Date();
  communication.errorMessage = undefined;
  await communication.save();
  return communication;
};

const getCandidateCommunicationSnapshot = async (candidateIds, recruiterId) => {
  const scope = recruiterId ? { recruiterId } : {};
  const [calls, communications, followUps] = await Promise.all([
    CallLog.find({ candidateId: { $in: candidateIds }, ...scope }).sort({ createdAt: -1 }).lean(),
    Communication.find({ candidateId: { $in: candidateIds }, ...scope }).sort({ createdAt: -1 }).lean(),
    FollowUp.find({ candidateId: { $in: candidateIds }, ...scope }).sort({ dueDate: 1, dueTime: 1 }).lean(),
  ]);

  const byCandidate = new Map();
  candidateIds.forEach((id) => byCandidate.set(String(id), {}));
  calls.forEach((call) => {
    const bucket = byCandidate.get(String(call.candidateId));
    if (bucket && !bucket.lastCall) bucket.lastCall = call;
  });
  communications.forEach((communication) => {
    const bucket = byCandidate.get(String(communication.candidateId));
    if (bucket && !bucket.lastCommunication) bucket.lastCommunication = communication;
  });
  followUps.forEach((followUp) => {
    const bucket = byCandidate.get(String(followUp.candidateId));
    if (!bucket) return;
    if (["Pending", "Overdue"].includes(followUp.status) && !bucket.nextFollowUp) bucket.nextFollowUp = followUp;
    const previous = bucket.latestFollowUp;
    const changedAt = item => new Date(item.updatedAt || item.createdAt || item.dueDate).getTime();
    if (!previous || changedAt(followUp) > changedAt(previous)) bucket.latestFollowUp = followUp;
  });
  return byCandidate;
};

router.get("/requirements", async (req, res) => {
  try {
    const { search = "", status = "all", location = "", page = 1, limit = 10 } = req.query;
    const query = { ...recruiterJobQuery(req.user) };
    if (status && status !== "all") query.status = status;
    if (search) query.title = new RegExp(escapeRegex(search), "i");
    if (location) query["location.name"] = new RegExp(escapeRegex(location), "i");

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
    const skip = (pageNum - 1) * limitNum;

    const [jobs, totalJobs] = await Promise.all([
      Job.find(query).populate("clientId", "companyName name clientName").sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Job.countDocuments(query),
    ]);
    const jobIds = jobs.map((job) => job._id);
    const [candidateCounts, pendingCounts] = await Promise.all([
      SourcedCandidate.aggregate([
        { $match: { requirementId: { $in: jobIds }, ...(canSeeAllFollowUps(req.user) ? {} : { recruiterId: req.user._id }) } },
        { $group: { _id: "$requirementId", count: { $sum: 1 } } },
      ]),
      FollowUp.aggregate([
        { $match: { requirementId: { $in: jobIds }, ...ownerScope(req), status: "Pending" } },
        { $group: { _id: "$requirementId", count: { $sum: 1 } } },
      ]),
    ]);
    const candidateCountMap = new Map(candidateCounts.map((item) => [String(item._id), item.count]));
    const pendingCountMap = new Map(pendingCounts.map((item) => [String(item._id), item.count]));

    res.json({
      success: true,
      requirements: jobs.map((job) => buildJobSummary(job, {
        candidateCount: candidateCountMap.get(String(job._id)) || 0,
        pendingFollowUpsCount: pendingCountMap.get(String(job._id)) || 0,
      })),
      currentPage: pageNum,
      totalPages: Math.ceil(totalJobs / limitNum),
      totalJobs,
    });
  } catch (error) {
    console.error("Follow-up requirements error:", error);
    res.status(500).json({ success: false, message: "Failed to load requirements" });
  }
});

router.get("/summary", async (req, res) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const now = new Date();
    const base = ownerScope(req);
    const [todays, overdue, pendingCalls, pendingEmails, pendingWhatsApp, completedToday] = await Promise.all([
      FollowUp.countDocuments({ ...base, dueDate: { $gte: start, $lte: end }, status: "Pending" }),
      FollowUp.countDocuments({ ...base, dueDate: { $lt: start }, status: "Pending" }),
      FollowUp.countDocuments({ ...base, type: "Call", status: "Pending" }),
      FollowUp.countDocuments({ ...base, type: "Email", status: "Pending" }),
      FollowUp.countDocuments({ ...base, type: "WhatsApp", status: "Pending" }),
      FollowUp.countDocuments({ ...base, completedAt: { $gte: start, $lte: end }, status: "Completed" }),
    ]);
    await FollowUp.updateMany({ ...base, dueDate: { $lt: now }, status: "Pending" }, { $set: { status: "Overdue" } });
    res.json({ success: true, summary: { todays, overdue, pendingCalls, pendingEmails, pendingWhatsApp, completedToday } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load summary" });
  }
});

router.get("/requirements/:requirementId", async (req, res) => {
  try {
    const job = await assertJobAccess(req, req.params.requirementId);
    if (!job) return res.status(404).json({ success: false, message: "Requirement not found" });
    const cleanJob = { ...job };
    delete cleanJob.assignedRecruiters;
    delete cleanJob.assignedMentors;
    delete cleanJob.leadRecruiter;
    delete cleanJob.CreatedBy;
    delete cleanJob.UpdatedBy;
    res.json({ success: true, requirement: { ...cleanJob, summary: buildJobSummary(job) } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load requirement" });
  }
});

router.get("/requirements/:requirementId/candidates/check-duplicate", async (req, res) => {
  try {
    const job = await assertJobAccess(req, req.params.requirementId);
    if (!job) return res.status(404).json({ success: false, message: "Requirement not found" });

    const { email = "", phone = "", candidateId } = req.query;
    if (candidateId) {
      const access = await assertCandidateAccess(req, candidateId);
      if (!access.candidate || toId(access.job._id) !== toId(job._id)) return res.status(404).json({ success: false, message: "Candidate not found" });
    }
    const matchConditions = buildCandidateMatchConditions(email, phone);
    if (matchConditions.length === 0) {
      return res.json({ success: true, hasDuplicate: false, duplicates: [] });
    }

    const additionBlock = await getCandidateAdditionBlock(req, job, email, phone, true, candidateId || null);

    const duplicates = await SourcedCandidate.find({ $or: matchConditions, ...(candidateId ? { _id: { $ne: candidateId } } : {}) })
      .populate("recruiterId", "name email designation")
      .populate("requirementId", "title")
      .sort({ createdAt: 1 })
      .lean();

    const formatted = duplicates.map((d) => ({
      _id: d._id,
      name: d.name || "Candidate",
      email: d.email,
      phone: d.phoneNumber,
      createdAt: d.createdAt,
      isSameRequirement: toId(d.requirementId?._id || d.requirementId) === toId(job._id),
      isSameRecruiter: toId(d.recruiterId?._id || d.recruiterId) === toId(req.user._id),
      requirementTitle: d.requirementId?.title || "Requirement",
      addedBy: {
        _id: d.recruiterId?._id || d.recruiterId,
        name: d.recruiterId?.name || "Unknown User",
        email: d.recruiterId?.email || "",
        designation: d.recruiterId?.designation || "",
      },
    }));

    res.json({
      success: true,
      ...additionBlock,
      hasDuplicate: additionBlock.duplicateSource === "normal" || (req.user.designation !== "Recruiter" && formatted.length > 0),
      duplicates: req.user.designation === "Recruiter" ? formatted.map(d => ({ isSameRequirement: d.isSameRequirement, isSameRecruiter: d.isSameRecruiter })) : formatted,
    });
  } catch (error) {
    console.error("Check duplicate error:", error);
    res.status(500).json({ success: false, message: "Failed to check duplicate" });
  }
});

router.get("/requirements/:requirementId/candidates", async (req, res) => {
  try {
    const job = await assertJobAccess(req, req.params.requirementId);
    if (!job) return res.status(404).json({ success: false, message: "Requirement not found" });

    const candidates = await SourcedCandidate.find({ requirementId: job._id, ...ownerScope(req) })
      .populate("recruiterId", "name email designation")
      .sort({ createdAt: -1 })
      .lean();

    const candidateIds = candidates.map((c) => c._id);
    const snapshot = await getCandidateCommunicationSnapshot(candidateIds, canSeeAllFollowUps(req.user) ? null : req.user._id);

    const emails = candidates.map((c) => c.email).filter(Boolean);
    const phones = candidates.map((c) => c.phoneNumber).filter(Boolean);

    let allDuplicates = [];
    if (emails.length > 0 || phones.length > 0) {
      const or = [];
      if (emails.length > 0) {
        or.push({ email: { $in: emails.map((e) => new RegExp(`^${escapeRegex(e.trim())}$`, "i")) } });
      }
      if (phones.length > 0) {
        const phoneRegexes = phones.map((p) => buildPhoneRegex(p)).filter(Boolean);
        if (phoneRegexes.length > 0) {
          or.push({ phoneNumber: { $in: phoneRegexes } });
        }
      }
      if (or.length > 0) {
        allDuplicates = await SourcedCandidate.find({ $or: or })
          .populate("recruiterId", "name email designation")
          .populate("requirementId", "title")
          .sort({ createdAt: 1 })
          .lean();
      }
    }

    const enrichedCandidates = candidates.map((candidate) => {
      const candEmail = String(candidate.email || "").toLowerCase().trim();
      const candDigits = String(candidate.phoneNumber || "").replace(/\D/g, "");
      const candLast10 = candDigits.length >= 10 ? candDigits.slice(-10) : candDigits;

      const matches = allDuplicates.filter((other) => {
        if (toId(other._id) === toId(candidate._id)) return false;
        const otherEmail = String(other.email || "").toLowerCase().trim();
        const otherDigits = String(other.phoneNumber || "").replace(/\D/g, "");
        const otherLast10 = otherDigits.length >= 10 ? otherDigits.slice(-10) : otherDigits;

        const emailMatch = Boolean(candEmail && otherEmail && candEmail === otherEmail);
        const phoneMatch = Boolean(candLast10 && otherLast10 && candLast10 === otherLast10);
        return emailMatch || phoneMatch;
      });

      const hasDuplicates = matches.length > 0;
      const allGroup = [candidate, ...matches].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const isOriginal = allGroup[0] && toId(allGroup[0]._id) === toId(candidate._id);
      const originalCandidate = allGroup[0];

      const duplicateProfiles = matches.map((m) => ({
        _id: m._id,
        name: m.name || "Candidate",
        email: m.email,
        phone: m.phoneNumber,
        createdAt: m.createdAt,
        isSameRequirement: toId(m.requirementId?._id || m.requirementId) === toId(job._id),
        requirementTitle: m.requirementId?.title || "Requirement",
        addedBy: {
          _id: m.recruiterId?._id || m.recruiterId,
          name: m.recruiterId?.name || "Unknown User",
          email: m.recruiterId?.email || "",
          designation: m.recruiterId?.designation || "",
        },
      }));

      return buildCandidateSummary(candidate, {
        isOwner: toId(candidate.recruiterId?._id || candidate.recruiterId) === toId(req.user._id),
        isDuplicate: hasDuplicates,
        isOriginal: hasDuplicates ? isOriginal : false,
        duplicateCount: hasDuplicates ? allGroup.length : 1,
        duplicateProfiles,
        originalAddedBy: hasDuplicates && !isOriginal ? {
          _id: originalCandidate?.recruiterId?._id || originalCandidate?.recruiterId,
          name: originalCandidate?.recruiterId?.name || "Unknown User",
          email: originalCandidate?.recruiterId?.email || "",
          createdAt: originalCandidate?.createdAt,
        } : null,
        ...(snapshot.get(String(candidate._id)) || {}),
      });
    });

    res.json({
      success: true,
      candidates: req.user.designation === "Recruiter" ? enrichedCandidates.map(({ duplicateProfiles, originalAddedBy, duplicateCount, isOriginal, ...candidate }) => ({ ...candidate, isDuplicate: false })) : enrichedCandidates,
    });
  } catch (error) {
    console.error("Follow-up candidates load error:", error);
    res.status(500).json({ success: false, message: "Failed to load candidates" });
  }
});

router.post("/requirements/:requirementId/candidates", upload.single("resume"), async (req, res) => {
  try {
    const job = await assertJobAccess(req, req.params.requirementId);
    if (!job) return res.status(404).json({ success: false, message: "Requirement not found" });
    if (req.user.designation === "Recruiter" && job.status !== "Open") {
      return res.status(403).json({ success: false, message: "Candidates can only be added to open requirements" });
    }

    const { candidateName, email, phone } = req.body;
    if (!candidateName || !email || !phone || !req.file) {
      return res.status(400).json({ success: false, message: "Candidate name, email, phone and resume are required" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Invalid candidate email" });
    }

    const cleanEmail = email.trim();
    const cleanPhone = phone.trim();
    const matchConditions = buildCandidateMatchConditions(cleanEmail, cleanPhone);

    const additionBlock = await getCandidateAdditionBlock(req, job, cleanEmail, cleanPhone);
    if (!additionBlock.canAdd) return res.status(409).json({ success: false, ...additionBlock });

    const existingCandidates = await SourcedCandidate.find({ $or: matchConditions })
      .populate("recruiterId", "name email designation")
      .populate("requirementId", "title")
      .sort({ createdAt: 1 })
      .lean();

    const isDuplicate = existingCandidates.length > 0;
    const earliestCandidate = isDuplicate ? existingCandidates[0] : null;
    const previousAdderName = earliestCandidate?.recruiterId?.name || "another user";

    const candidate = await SourcedCandidate.create({
      requirementId: job._id,
      recruiterId: req.user._id,
      resumeFileUrl: req.file.location || req.file.path,
      name: candidateName.trim(),
      email: cleanEmail,
      phoneNumber: cleanPhone,
      sourceType: "Follow-up Upload",
      isDuplicate: isDuplicate,
      originalCandidateId: earliestCandidate ? earliestCandidate._id : null,
    });

    if (isDuplicate) {
      await SourcedCandidate.updateMany(
        { _id: { $in: existingCandidates.map((c) => c._id) } },
        { $set: { isDuplicate: true } }
      );
    }

    const activityDesc = isDuplicate
      ? `Duplicate candidate profile added by ${req.user.name} (Previously added by ${previousAdderName})`
      : "Sourced candidate added from Follow-ups";

    logActivity(req.user._id, "created", "source-candidate", activityDesc, candidate._id, "SourceCandidate", {
      actionType: "candidate_created",
      jobId: job._id,
      performedByRole: req.user.designation,
      metadata: {
        source: "recruiter_followups",
        sourceCandidateId: candidate._id,
        isDuplicate,
        previouslyAddedBy: previousAdderName,
        originalCandidateId: earliestCandidate?._id,
      },
    });

    const populatedCandidate = await SourcedCandidate.findById(candidate._id)
      .populate("recruiterId", "name email designation")
      .lean();

    const formattedPrevious = existingCandidates.map((c) => ({
      _id: c._id,
      name: c.name || "Candidate",
      email: c.email,
      phone: c.phoneNumber,
      createdAt: c.createdAt,
      requirementTitle: c.requirementId?.title || "Requirement",
      addedBy: {
        _id: c.recruiterId?._id || c.recruiterId,
        name: c.recruiterId?.name || "Unknown User",
        email: c.recruiterId?.email || "",
        designation: c.recruiterId?.designation || "",
      },
    }));

    res.status(201).json({
      success: true,
      message: req.user.designation === "Recruiter" ? "Candidate added successfully" : isDuplicate
        ? `Candidate profile added! Note: This profile was already added by ${previousAdderName}.`
        : "Candidate added successfully",
      isDuplicate: req.user.designation === "Recruiter" ? false : isDuplicate,
      ...(req.user.designation === "Recruiter" ? {} : { previouslyAddedBy: previousAdderName, previousProfiles: formattedPrevious }),
      candidate: buildCandidateSummary(populatedCandidate, { isOwner: true }),
    });
  } catch (error) {
    console.error("Follow-up candidate create error:", error);
    res.status(500).json({ success: false, message: "Failed to add candidate" });
  }
});

router.patch("/candidates/:candidateId", upload.single("resume"), async (req, res) => {
  try {
    const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
    if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
    const name = String(req.body.candidateName || "").trim();
    const email = String(req.body.email || "").trim();
    const phoneNumber = String(req.body.phone || "").trim();
    if (!name || !email || !phoneNumber) return res.status(400).json({ success: false, message: "Candidate name, email and phone are required" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: "Invalid candidate email" });
    if (!/^\d{10,15}$/.test(phoneNumber.replace(/\D/g, ""))) return res.status(400).json({ success: false, message: "Enter a valid phone number" });
    const block = await getCandidateAdditionBlock(req, job, email, phoneNumber, true, candidate._id);
    if (!block.canAdd) return res.status(409).json({ success: false, ...block });
    const updates = { name, email, phoneNumber };
    if (req.file) updates.resumeFileUrl = req.file.location || req.file.path;
    const updated = await SourcedCandidate.findOneAndUpdate({ _id: candidate._id, ...ownerScope(req) }, { $set: updates }, { new: true, runValidators: true }).populate("recruiterId", "name email designation").lean();
    if (!updated) return res.status(404).json({ success: false, message: "Candidate not found" });
    // Already-sent or in-flight messages retain their original recipient.
    const unsent = { candidateId: candidate._id, status: { $in: ["generated", "reviewed", "scheduled", "failed"] } };
    await Communication.updateMany({ ...unsent, channel: "EMAIL" }, { $set: { recipient: email } });
    await Communication.updateMany({ ...unsent, channel: "WHATSAPP" }, { $set: { recipient: normalizeWhatsAppPhone(phoneNumber) } });
    logActivity(req.user._id, "updated", "source-candidate", "Candidate profile updated", candidate._id, "SourceCandidate", { actionType: "candidate_updated", candidateId: candidate._id, jobId: job._id });
    res.json({ success: true, candidate: buildCandidateSummary(updated) });
  } catch (error) {
    console.error("Candidate update failed:", error);
    res.status(500).json({ success: false, message: "Failed to update candidate" });
  }
});

// Candidate deletion is restricted to administrators, including bulk requests.
router.delete("/requirements/:requirementId/candidates", async (req, res) => {
  if (req.user.designation !== "Admin") return res.status(403).json({ success: false, message: "Only admins can delete candidates" });
  try {
    const job = await assertJobAccess(req, req.params.requirementId);
    if (!job) return res.status(404).json({ success: false, message: "Requirement not found" });
    const ids = req.body.candidateIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some(id => typeof id !== "string" || !isObjectId(id))) return res.status(400).json({ success: false, message: "Select valid candidates to delete (up to 500)" });
    const candidates = await SourcedCandidate.find({ _id: { $in: ids }, requirementId: job._id }).select("_id").lean();
    if (candidates.length !== new Set(ids).size) return res.status(400).json({ success: false, message: "Some selected candidates no longer exist in this requirement. Refresh and try again." });
    const candidateIds = candidates.map(candidate => candidate._id);
    const scope = { candidateId: { $in: candidateIds }, requirementId: job._id };
    await Communication.updateMany(scope, { $set: { status: "stopped", stoppedAt: new Date(), stopReason: "candidate_deleted" } });
    await FollowUp.deleteMany(scope);
    await CallLog.deleteMany(scope);
    await Communication.deleteMany(scope);
    await SourcedCandidate.updateMany({ originalCandidateId: { $in: candidateIds } }, { $set: { originalCandidateId: null } });
    const result = await SourcedCandidate.deleteMany({ _id: { $in: candidateIds }, requirementId: job._id });
    logActivity(req.user._id, "deleted", "source-candidate", `Deleted ${result.deletedCount} candidate profiles`, job._id, "Job", { actionType: "candidates_deleted", jobId: job._id, performedByRole: req.user.designation, metadata: { candidateIds } });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (error) {
    console.error("Candidate deletion failed:", error);
    res.status(500).json({ success: false, message: "Failed to delete candidates. Refresh and try again." });
  }
});

router.patch("/candidates/:candidateId/status", async (req, res) => {
  try {
    const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
    if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
    const statuses = ["Not interested", "Wrong number", "No answer", "Busy", "Lineup"];
    if (!statuses.includes(req.body.status)) return res.status(400).json({ success: false, message: "Select a valid candidate status" });
    await SourcedCandidate.updateOne({ _id: candidate._id }, { $set: { status: req.body.status } });
    logActivity(req.user._id, "updated", "source-candidate", `Candidate status: ${req.body.status}`, candidate._id, "SourceCandidate", { actionType: "candidate_status_updated", candidateId: candidate._id, jobId: job._id, oldValue: candidate.status || "Sourced", newValue: req.body.status });
    res.json({ success: true, status: req.body.status });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to update candidate status" }); }
});

router.get("/candidates/:candidateId/lineup", async (req, res) => {
  try {
    const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
    if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
    res.json({ success: true, ...getLineupForm(candidate, job), hasResume: Boolean(candidate.resumeFileUrl), jobTitle: job.title });
  } catch (error) { res.status(500).json({ success: false, message: "Failed to load mandatory fields" }); }
});

router.post("/candidates/:candidateId/lineup", async (req, res) => {
  try {
    const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
    if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
    if (req.user.designation === "Recruiter" && job.status !== "Open") return res.status(403).json({ success: false, message: "Candidates can only be converted for open requirements" });
    const form = getLineupForm(candidate, job);
    const { errors, dynamicFields } = validateLineupFields(form.fields, { ...form.values, ...(req.body.dynamicFields || {}) });
    if (errors.length) return res.status(400).json({ success: false, message: "Complete the mandatory fields before converting", errors });
    // Reuse the source ID: retries cannot create a second normal candidate.
    let normal = await CandidateByJob.findById(candidate._id);
    if (normal && toId(normal.jobId) !== toId(job._id)) return res.status(409).json({ success: false, message: "Candidate already belongs to another requirement" });
    if (!normal) {
      const block = await getCandidateAdditionBlock(req, job, dynamicFields.Email, dynamicFields.Phone, false);
      if (!block.canAdd) return res.status(409).json({ success: false, ...block });
      normal = await CandidateByJob.create({ _id: candidate._id, jobId: job._id, createdBy: candidate.recruiterId?._id || candidate.recruiterId, dynamicFields, resumeUrl: candidate.resumeFileUrl, linkedinUrl: candidate.linkedinProfile, notes: "Converted to lineup from Follow-ups", status: "New" });
    }
    // Stop the source workflow before removing its profile. Preserve its history for audit.
    await Communication.updateMany({ candidateId: candidate._id, status: { $in: ["generated", "reviewed", "scheduled", "failed"] } }, { $set: { status: "stopped", stoppedAt: new Date(), stopReason: "converted_to_lineup" } });
    await FollowUp.updateMany({ candidateId: candidate._id, status: { $in: ["Pending", "Overdue"] } }, { $set: { status: "Cancelled" } });
    await SourcedCandidate.updateMany({ originalCandidateId: candidate._id }, { $set: { originalCandidateId: null } });
    const candidateCount = await CandidateByJob.countDocuments({ jobId: job._id });
    await Job.updateOne({ _id: job._id }, { $set: { candidateCount } });
    await SourcedCandidate.deleteOne({ _id: candidate._id });
    logActivity(req.user._id, "created", "candidate", "Converted sourced profile to lineup", normal._id, "CandidateByJob", { actionType: "candidate_created", candidateId: normal._id, jobId: job._id, metadata: { source: "followups_lineup", sourceCandidateId: candidate._id } });
    res.json({ success: true, candidateId: normal._id });
  } catch (error) {
    console.error("Lineup conversion failed:", error);
    res.status(error.code === 11000 ? 409 : 500).json({ success: false, message: error.code === 11000 ? "Conversion is already in progress. Refresh before retrying." : "Failed to convert candidate. You can retry safely." });
  }
});

router.post("/candidates/:candidateId/calls", async (req, res) => {
  try {
    const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
    if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
    const { callDate, callTime, status, outcome = "Other", notes = "", nextFollowUpDate, nextFollowUpTime, scheduleFollowUp, followUpType = "Call", followUpRemarks } = req.body;
    if (!callDate || !callTime || !status) return res.status(400).json({ success: false, message: "Call date, time and status are required" });

    const call = await CallLog.create({
      candidateId: candidate._id,
      requirementId: job._id,
      recruiterId: req.user._id,
      callDate,
      callTime,
      status,
      outcome,
      notes,
      nextFollowUpDate,
      nextFollowUpTime,
    });
    await Communication.create({
      candidateId: candidate._id,
      requirementId: job._id,
      recruiterId: req.user._id,
      channel: "CALL",
      recipient: getCandidateField(candidate, ["phoneNumber", "Phone", "phone", "Mobile", "mobile"]) || "N/A",
      body: notes || `${status}${outcome ? ` - ${outcome}` : ""}`,
      status: "sent",
      sentAt: new Date(),
    });
    let followUp = null;
    if (scheduleFollowUp && nextFollowUpDate && nextFollowUpTime) {
      followUp = await FollowUp.create({
        candidateId: candidate._id,
        requirementId: job._id,
        recruiterId: req.user._id,
        type: followUpType,
        dueDate: nextFollowUpDate,
        dueTime: nextFollowUpTime,
        notes: followUpRemarks !== undefined ? String(followUpRemarks).trim() : notes || `Follow-up after call status: ${status}`,
      });
    }
    logActivity(req.user._id, "created", "candidate-call", `Call logged: ${status}`, candidate._id, "SourceCandidate", {
      actionType: status === "No Answer" ? "no_answer" : "call",
      candidateId: candidate._id,
      jobId: job._id,
      performedByRole: req.user.designation,
      metadata: { sourceCandidateId: candidate._id, callStatus: status, outcome, notes, followUpId: followUp?._id },
    });
    res.status(201).json({ success: true, call, followUp });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to log call" });
  }
});

router.get("/candidates/:candidateId/calls", async (req, res) => {
  const { candidate } = await assertCandidateAccess(req, req.params.candidateId);
  if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
  const calls = await CallLog.find({ candidateId: candidate._id }).sort({ createdAt: -1 }).lean();
  res.json({ success: true, calls });
});

router.post("/candidates/:candidateId/follow-ups", async (req, res) => {
  try {
    const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
    if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
    const { type, dueDate, dueTime, notes = "" } = req.body;
    if (!type || !dueDate || !dueTime) return res.status(400).json({ success: false, message: "Follow-up type, due date and due time are required" });
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) return res.status(400).json({ success: false, message: "Invalid follow-up date" });
    const followUp = await FollowUp.create({ candidateId: candidate._id, requirementId: job._id, recruiterId: req.user._id, type, dueDate: due, dueTime, notes });
    logActivity(req.user._id, "created", "candidate-follow-up", `Follow-up created: ${type}`, candidate._id, "SourceCandidate", {
      actionType: "follow_up_created",
      candidateId: candidate._id,
      jobId: job._id,
      performedByRole: req.user.designation,
      metadata: { type, dueDate, dueTime, notes, sourceCandidateId: candidate._id },
    });
    res.status(201).json({ success: true, followUp });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to create follow-up" });
  }
});

router.get("/candidates/:candidateId/follow-ups", async (req, res) => {
  const { candidate } = await assertCandidateAccess(req, req.params.candidateId);
  if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
  const followUps = await FollowUp.find({ candidateId: candidate._id }).sort({ dueDate: 1, dueTime: 1 }).lean();
  res.json({ success: true, followUps });
});

router.get("/follow-ups", async (req, res) => {
  const { requirementId, status, type } = req.query;
  const query = ownerScope(req);
  if (requirementId && isObjectId(requirementId)) query.requirementId = requirementId;
  if (status && status !== "all") query.status = status;
  if (type && type !== "all") query.type = type;
  const followUps = await FollowUp.find(query)
    .populate("candidateId", "name email phoneNumber resumeFileUrl")
    .populate("requirementId", "title")
    .sort({ dueDate: 1, dueTime: 1 })
    .lean();
  res.json({ success: true, followUps });
});

router.patch("/:followUpId", async (req, res) => {
  try {
    const followUp = await FollowUp.findOne({ _id: req.params.followUpId, ...ownerScope(req) });
    if (!followUp) return res.status(404).json({ success: false, message: "Follow-up not found" });
    if (followUp.status === "Completed" && req.body.status === "Completed") {
      return res.status(400).json({ success: false, message: "Follow-up is already completed" });
    }
    ["type", "dueDate", "dueTime", "notes", "status"].forEach((field) => {
      if (req.body[field] !== undefined) followUp[field] = req.body[field];
    });
    if (req.body.status === "Completed") followUp.completedAt = new Date();
    if (req.body.status === "Pending") followUp.completedAt = undefined;
    await followUp.save();
    logActivity(req.user._id, "updated", "candidate-follow-up", `Follow-up ${followUp.status.toLowerCase()}`, followUp.candidateId, "SourceCandidate", {
      actionType: followUp.status === "Completed" ? "follow_up_completed" : followUp.status === "Cancelled" ? "follow_up_cancelled" : "follow_up_updated",
      candidateId: followUp.candidateId,
      jobId: followUp.requirementId,
      performedByRole: req.user.designation,
      metadata: { type: followUp.type, dueDate: followUp.dueDate, dueTime: followUp.dueTime, notes: followUp.notes },
    });
    res.json({ success: true, followUp });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update follow-up" });
  }
});

router.get("/candidates/:candidateId/draft-studio", async (req, res) => {
  try {
    const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
    if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
    const allDrafts = await Communication.find({
      candidateId: candidate._id,
      requirementId: job._id,
      recruiterId: req.user._id,
      channel: req.query.channel === "whatsapp" ? "WHATSAPP" : "EMAIL",
      sequenceId: { $type: "string" },
    }).sort({ createdAt: -1 }).lean();
    const currentSequenceId = allDrafts[0]?.sequenceId || "";
    const drafts = currentSequenceId
      ? allDrafts.filter((draft) => draft.sequenceId === currentSequenceId).sort((a, b) => (a.sequenceStep || 0) - (b.sequenceStep || 0))
      : [];
    const activeDrafts = drafts.filter((draft) => draft.status !== "stopped" || draft.sentAt);
    const sent = activeDrafts.filter((draft) => draft.status === "sent").length;
    const stopped = drafts.some((draft) => draft.status === "stopped" && !draft.sentAt);
    const scheduled = activeDrafts.some((draft) => ["scheduled", "pending"].includes(draft.status) && draft.scheduledAt);
    const reviewed = activeDrafts.length > 0 && activeDrafts.every((draft) => ["reviewed", "sent"].includes(draft.status));
    res.json({
      success: true,
      candidate: buildCandidateSummary(candidate),
      sequence: {
        id: currentSequenceId,
        status: stopped ? "Stopped" : drafts.length > 0 && sent >= drafts.length ? "Completed" : scheduled || sent > 0 ? "Active" : reviewed ? "Ready" : activeDrafts.length ? "Draft" : "Empty",
        sent,
        drafts: activeDrafts,
        templates: (job.communicationTemplates || []).filter(t => t.channel === (req.query.channel === "whatsapp" ? "WHATSAPP" : "EMAIL")).map((t, index) => ({ label: t.label, _id: `template-${index}`, subject: renderTemplate(t.subject, templateVariables(candidate, job, req.user)), body: renderTemplate(t.body, templateVariables(candidate, job, req.user)) })),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load draft studio" });
  }
});

router.post("/candidates/:candidateId/draft-studio/generate", async (req, res) => {
  try {
    const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
    if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
    const recipient = getCandidateField(candidate, ["email", "Email"]);
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return res.status(400).json({ success: false, message: "Invalid candidate email" });
    const existingDraft = await Communication.findOne({
      candidateId: candidate._id,
      requirementId: job._id,
      recruiterId: req.user._id,
      channel: req.query.channel === "whatsapp" ? "WHATSAPP" : "EMAIL",
      sequenceId: { $type: "string" },
      status: { $in: ["generated", "reviewed", "scheduled", "pending", "failed"] },
    }).sort({ createdAt: -1 }).lean();
    if (existingDraft) {
      return res.status(409).json({ success: false, message: "A draft sequence already exists. Clear it before generating a new one." });
    }
    const sequenceId = `ats-${candidate._id}-${Date.now()}`;

    const createdAt = new Date();
    const drafts = await Communication.insertMany((job.communicationTemplates || []).filter(t => t.channel === "EMAIL").map((t, step) => ({ step, subject: renderTemplate(t.subject, templateVariables(candidate, job, req.user)), body: renderTemplate(t.body, templateVariables(candidate, job, req.user)) })).map((draft) => ({
      candidateId: candidate._id,
      requirementId: job._id,
      recruiterId: req.user._id,
      channel: req.query.channel === "whatsapp" ? "WHATSAPP" : "EMAIL",
      recipient,
      subject: draft.subject,
      body: draft.body,
      status: "generated",
      sequenceId,
      sequenceStep: draft.step,
      scheduledAt: scheduleForStep(draft.step, createdAt),
      idempotencyKey: `${sequenceId}-${draft.step}`,
    })));

    logActivity(req.user._id, "generated", "candidate-email-sequence", "Five-email draft studio generated", candidate._id, "SourceCandidate", {
      actionType: "email_sequence_generated",
      candidateId: candidate._id,
      jobId: job._id,
      performedByRole: req.user.designation,
      metadata: { sequenceId },
    });
    res.json({ success: true, sequenceId, drafts });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to generate draft studio emails" });
  }
});

router.patch("/candidates/:candidateId/draft-studio/:draftId", async (req, res) => {
  try {
    const { candidate } = await assertCandidateAccess(req, req.params.candidateId);
    if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
    const draft = await Communication.findOne({
      _id: req.params.draftId,
      candidateId: candidate._id,
      recruiterId: req.user._id,
      channel: req.query.channel === "whatsapp" ? "WHATSAPP" : "EMAIL",
    });
    if (!draft) return res.status(404).json({ success: false, message: "Draft not found" });
    if (draft.status === "sent") return res.status(400).json({ success: false, message: "Sent emails cannot be edited" });
    if (req.body.subject !== undefined) draft.subject = String(req.body.subject || "");
    if (req.body.body !== undefined) draft.body = String(req.body.body || "");
    if (req.body.scheduledAt !== undefined) {
      draft.scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : undefined;
    }
    if (req.body.reviewed) {
      draft.status = "reviewed";
      draft.reviewedAt = new Date();
    }
    await draft.save();
    res.json({ success: true, draft });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update draft" });
  }
});

router.post("/candidates/:candidateId/draft-studio/review", async (req, res) => {
  try {
    const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
    if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
    const drafts = Array.isArray(req.body.drafts) ? req.body.drafts : [];
    if (drafts.length) {
      for (const item of drafts) {
        if (!item?._id) continue;
        await Communication.updateOne({
          _id: item._id,
          candidateId: candidate._id,
          requirementId: job._id,
          recruiterId: req.user._id,
          channel: req.query.channel === "whatsapp" ? "WHATSAPP" : "EMAIL",
          sequenceId: req.body.sequenceId,
          status: { $in: ["generated", "reviewed"] },
        }, {
          $set: {
            subject: String(item.subject || ""),
            body: String(item.body || ""),
            scheduledAt: item.scheduledAt ? new Date(item.scheduledAt) : undefined,
            status: "reviewed",
            reviewedAt: new Date(),
          },
        });
      }
    } else {
      await Communication.updateMany({
        candidateId: candidate._id,
        requirementId: job._id,
        recruiterId: req.user._id,
        channel: req.query.channel === "whatsapp" ? "WHATSAPP" : "EMAIL",
        sequenceId: req.body.sequenceId,
        status: "generated",
      }, { $set: { status: "reviewed", reviewedAt: new Date() } });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to mark drafts reviewed" });
  }
});

router.post("/candidates/:candidateId/draft-studio/start", async (req, res) => {
  try {
    const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
    if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
    const channel = req.query.channel === "whatsapp" ? "WHATSAPP" : "EMAIL";
    if (channel === "EMAIL") await getUserEmailOptions(req.user._id);
    const recipient = channel === "EMAIL" ? getCandidateField(candidate, ["email", "Email"]) : normalizeWhatsAppPhone(getCandidateField(candidate, ["phoneNumber", "Phone", "phone", "Mobile", "mobile"]));
    if (!recipient || (channel === "EMAIL" ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) : recipient.length < 11 || recipient.length > 15)) return res.status(400).json({ success: false, message: "Invalid candidate contact details" });
    const existing = await Communication.findOne({ candidateId: candidate._id, requirementId: job._id, recruiterId: req.user._id, channel, sequenceId: { $type: "string" }, status: { $in: ["scheduled", "pending"] } });
    if (existing) return res.status(409).json({ success: false, message: "A sequence is already active" });
    const templates = (job.communicationTemplates || []).filter(t => t.channel === channel);
    if (!templates.length || templates.some(t => !t.body.trim() || (channel === "EMAIL" && !t.subject.trim()))) return res.status(400).json({ success: false, message: "Add complete templates to this requirement before starting" });
    const sequenceId = `ats-${candidate._id}-${channel}-${Date.now()}`;
    const vars = templateVariables(candidate, job, req.user);
    const drafts = await Communication.insertMany(templates.map((t, step) => ({ candidateId: candidate._id, requirementId: job._id, recruiterId: req.user._id, channel, recipient, subject: renderTemplate(t.subject, vars), body: renderTemplate(t.body, vars), status: "generated", sequenceId, sequenceStep: step, idempotencyKey: `${sequenceId}-${step}` })));
    const startedAt = new Date();
    const scheduled = [];
    for (const draft of drafts) {
      if ((channel === "EMAIL" && !draft.subject) || !draft.body) throw new Error("All drafts need subject and body");
      draft.status = "scheduled";
      draft.scheduledAt = draft.scheduledAt || scheduleForStep(draft.sequenceStep || 0, startedAt);
      draft.errorMessage = undefined;
      await draft.save();
      scheduled.push(draft);
    }
    const workerResult = await runEmailSequenceWorkerOnce();
    logActivity(req.user._id, "scheduled", "candidate-email-sequence", `Email sequence scheduled: ${scheduled.length} emails`, candidate._id, "SourceCandidate", {
      actionType: "email_sequence_scheduled",
      candidateId: candidate._id,
      jobId: job._id,
      performedByRole: req.user.designation,
      metadata: { recipient, sequenceId, scheduled: scheduled.length, workerResult },
    });
    res.json({ success: true, scheduled, workerResult });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: "Email sequence scheduling failed", ...formatEmailErrorResponse(error) });
  }
});

router.post("/candidates/:candidateId/draft-studio/stop", async (req, res) => {
  try {
    const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
    if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
    const result = await Communication.updateMany({
      candidateId: candidate._id,
      requirementId: job._id,
      recruiterId: req.user._id,
      channel: req.query.channel === "whatsapp" ? "WHATSAPP" : "EMAIL",
      sequenceId: req.body.sequenceId,
      status: { $in: ["generated", "reviewed", "scheduled", "failed"] },
    }, { $set: { status: "stopped", stoppedAt: new Date(), stopReason: req.body.reason || "manual_stop" } });
    logActivity(req.user._id, "stopped", "candidate-email-sequence", "Email sequence stopped", candidate._id, "SourceCandidate", {
      actionType: "email_sequence_stopped",
      candidateId: candidate._id,
      jobId: job._id,
      performedByRole: req.user.designation,
      metadata: { sequenceId: req.body.sequenceId, stopped: result.modifiedCount },
    });
    res.json({ success: true, stopped: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to stop email sequence" });
  }
});

router.delete("/candidates/:candidateId/draft-studio", async (req, res) => {
  try {
    const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
    if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
    if (!req.body.sequenceId) return res.status(400).json({ success: false, message: "Sequence id is required" });
    const result = await Communication.deleteMany({
      candidateId: candidate._id,
      requirementId: job._id,
      recruiterId: req.user._id,
      channel: req.query.channel === "whatsapp" ? "WHATSAPP" : "EMAIL",
      sequenceId: req.body.sequenceId,
      status: { $in: ["generated", "reviewed", "scheduled", "pending", "failed", "stopped"] },
    });
    logActivity(req.user._id, "deleted", "candidate-email-sequence", "Email draft sequence cleared", candidate._id, "SourceCandidate", {
      actionType: "email_sequence_cleared",
      candidateId: candidate._id,
      jobId: job._id,
      performedByRole: req.user.designation,
      metadata: { sequenceId: req.body.sequenceId, deleted: result.deletedCount },
    });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to clear email drafts" });
  }
});

router.post("/candidates/:candidateId/email/generate", async (req, res) => {
  const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
  if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
  const category = EMAIL_CATEGORIES.includes(req.body.category) ? req.body.category : "Custom";
  const templates = (job.communicationTemplates || []).filter(t => t.channel === "EMAIL").map(t => ({ label: t.label, subject: renderTemplate(t.subject, templateVariables(candidate, job, req.user)), body: renderTemplate(t.body, templateVariables(candidate, job, req.user)) }));
  logActivity(req.user._id, "generated", "candidate-email", `Email templates generated: ${category}`, candidate._id, "SourceCandidate", {
    actionType: "email_generated",
    candidateId: candidate._id,
    jobId: job._id,
    performedByRole: req.user.designation,
    metadata: { category },
  });
  res.json({ success: true, templates });
});

router.post("/candidates/:candidateId/email/send", async (req, res) => {
  try {
    const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
    if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
    const recipient = req.body.recipient || getCandidateField(candidate, ["email", "Email"]);
    const { subject, body, htmlBody, idempotencyKey } = req.body;
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return res.status(400).json({ success: false, message: "Invalid candidate email" });
    if (!subject || !body) return res.status(400).json({ success: false, message: "Subject and body are required" });
    if (idempotencyKey) {
      const existing = await Communication.findOne({ recruiterId: req.user._id, channel: "EMAIL", idempotencyKey });
      if (existing) return res.json({ success: true, communication: existing, duplicate: true });
    }
    await getUserEmailOptions(req.user._id);
    const communication = await Communication.create({
      candidateId: candidate._id,
      requirementId: job._id,
      recruiterId: req.user._id,
      channel: "EMAIL",
      recipient,
      subject,
      body,
      status: "pending",
      idempotencyKey,
    });
    try {
      const result = await sendUserMail(req.user._id, {
        to: recipient,
        subject,
        html: htmlBody || body.replace(/\n/g, "<br/>"),
        text: body,
      });
      communication.status = "sent";
      communication.providerMessageId = result.messageId || result.traceId;
      communication.sentAt = new Date();
      await communication.save();
      logActivity(req.user._id, "sent", "candidate-email", `Email sent: ${subject}`, candidate._id, "SourceCandidate", {
        actionType: "email",
        candidateId: candidate._id,
        jobId: job._id,
        performedByRole: req.user.designation,
        metadata: { recipient, subject, sourceCandidateId: candidate._id },
      });
      res.json({ success: true, communication });
    } catch (error) {
      communication.status = "failed";
      communication.errorMessage = JSON.stringify(formatEmailErrorResponse(error));
      await communication.save();
      res.status(500).json({ success: false, message: "Email sending failed", ...formatEmailErrorResponse(error), communication });
    }
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: "Failed to send email", ...formatEmailErrorResponse(error) });
  }
});

router.post("/candidates/:candidateId/whatsapp/generate", async (req, res) => {
  const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
  if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
  const category = WHATSAPP_CATEGORIES.includes(req.body.category) ? req.body.category : "Custom";
  const templates = (job.communicationTemplates || []).filter(t => t.channel === "WHATSAPP").map(t => ({ label: t.label, subject: renderTemplate(t.subject, templateVariables(candidate, job, req.user)), body: renderTemplate(t.body, templateVariables(candidate, job, req.user)) }));
  logActivity(req.user._id, "generated", "candidate-whatsapp", `WhatsApp templates generated: ${category}`, candidate._id, "SourceCandidate", {
    actionType: "whatsapp_generated",
    candidateId: candidate._id,
    jobId: job._id,
    performedByRole: req.user.designation,
    metadata: { category },
  });
  res.json({ success: true, templates });
});

router.post("/candidates/:candidateId/whatsapp/send", async (req, res) => {
  try {
    const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
    if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
    const rawRecipient = req.body.recipient || getCandidateField(candidate, ["phoneNumber", "Phone", "phone", "Mobile", "mobile"]);
    const recipient = normalizeWhatsAppPhone(rawRecipient);
    const { body, idempotencyKey } = req.body;
    if (!recipient) return res.status(400).json({ success: false, message: "Candidate phone number is required" });
    if (recipient.length < 11 || recipient.length > 15) {
      return res.status(400).json({ success: false, message: "Enter a valid WhatsApp number with country code" });
    }
    if (!body) return res.status(400).json({ success: false, message: "Message body is required" });
    if (idempotencyKey) {
      const existing = await Communication.findOne({ recruiterId: req.user._id, channel: "WHATSAPP", idempotencyKey });
      if (existing) return res.json({ success: true, communication: existing, duplicate: true });
    }
    const communication = await Communication.create({
      candidateId: candidate._id,
      requirementId: job._id,
      recruiterId: req.user._id,
      channel: "WHATSAPP",
      recipient,
      body,
      status: "pending",
      idempotencyKey,
    });
    try {
      const result = await sendWhatsAppMessage({ to: recipient, body });
      communication.status = "sent";
      communication.providerMessageId = result.messageId;
      communication.sentAt = new Date();
      await communication.save();
      logActivity(req.user._id, "sent", "candidate-whatsapp", "WhatsApp message sent", candidate._id, "SourceCandidate", {
        actionType: "whatsapp_sent",
        candidateId: candidate._id,
        jobId: job._id,
        performedByRole: req.user.designation,
        metadata: { recipient, sourceCandidateId: candidate._id },
      });
      res.json({ success: true, communication });
    } catch (error) {
      communication.status = error.code === "WHATSAPP_PROVIDER_NOT_CONFIGURED" ? "not_configured" : "failed";
      communication.errorMessage = error.message;
      await communication.save();
      res.status(503).json({
        success: false,
        code: error.code || "WHATSAPP_SEND_FAILED",
        message: error.message,
        communication,
        whatsappUrl: buildWhatsAppUrl(recipient, body),
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to send WhatsApp message" });
  }
});

router.get("/candidates/:candidateId/activity", async (req, res) => {
  const { candidate } = await assertCandidateAccess(req, req.params.candidateId);
  if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
  const activities = await ActivityLog.find({
    $or: [{ candidateId: candidate._id }, { targetId: candidate._id, targetModel: "SourceCandidate" }],
  }).populate("userId", "name email designation").sort({ createdAt: -1 }).lean();
  res.json({ success: true, activities });
});

router.get("/templates", async (req, res) => {
  const templates = await CommunicationTemplate.find({ isActive: true }).sort({ type: 1, category: 1, templateName: 1 }).lean();
  res.json({ success: true, templates });
});

module.exports = router;
