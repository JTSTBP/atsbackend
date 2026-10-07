const express = require("express");
const mongoose = require("mongoose");
const Job = require("../models/Jobs");
const SourcedCandidate = require("../models/SourcedCandidate");
const CallLog = require("../models/CallLog");
const FollowUp = require("../models/FollowUp");
const Communication = require("../models/Communication");
const CommunicationTemplate = require("../models/CommunicationTemplate");
const ActivityLog = require("../models/activitylog");
const upload = require("../middleware/upload");
const { protect } = require("../middleware/authMiddleware");
const logActivity = require("./logactivity");
const { sendMail, formatEmailErrorResponse } = require("../services/emailService");
const { sendWhatsAppMessage } = require("../services/whatsappService");
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
  const candidate = await SourcedCandidate.findById(candidateId)
    .populate({
      path: "requirementId",
      populate: { path: "clientId", select: "companyName name clientName" },
    })
    .lean();
  if (!candidate || !candidate.requirementId) return { candidate: null, job: null };
  const job = await assertJobAccess(req, candidate.requirementId._id || candidate.requirementId);
  if (!job) return { candidate: null, job: null };
  if (!canSeeAllFollowUps(req.user) && toId(candidate.recruiterId) !== toId(req.user._id)) {
    return { candidate: null, job: null };
  }
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
  ...extras,
});

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
  candidateCount: counts.candidateCount || job.candidateCount || 0,
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

const renderTemplate = (text, variables) => String(text || "").replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || "");

const makeGeneratedTemplates = (channel, category, candidate, job, recruiter) => {
  const vars = templateVariables(candidate, job, recruiter);
  const baseSubject = `${vars.jobTitle} opportunity - ${vars.companyName}`;
  if (channel === "EMAIL") {
    return [
      {
        label: "Professional",
        subject: category === "No Answer" ? `Following up on ${vars.jobTitle}` : baseSubject,
        body: `Hi ${vars.candidateName},\n\nI tried reaching you regarding the ${vars.jobTitle} opportunity with ${vars.companyName} in ${vars.location}. Please let me know a convenient time to connect and discuss the role.\n\nRegards,\n${vars.recruiterName}`,
      },
      {
        label: "Short",
        subject: `Quick follow-up: ${vars.jobTitle}`,
        body: `Hi ${vars.candidateName},\n\nAre you available for a quick call about the ${vars.jobTitle} role? Please share a suitable time.\n\nThanks,\n${vars.recruiterName}`,
      },
      {
        label: "Friendly",
        subject: `Can we connect about ${vars.jobTitle}?`,
        body: `Hello ${vars.candidateName},\n\nHope you are doing well. I wanted to connect with you about a ${vars.jobTitle} opening at ${vars.companyName}. Please reply with a good time to talk.\n\nBest,\n${vars.recruiterName}`,
      },
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
    if (followUp.status === "Pending" && !bucket.nextFollowUp) bucket.nextFollowUp = followUp;
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

router.get("/requirements/:requirementId/candidates", async (req, res) => {
  try {
    const job = await assertJobAccess(req, req.params.requirementId);
    if (!job) return res.status(404).json({ success: false, message: "Requirement not found" });
    const candidates = await SourcedCandidate.find({ requirementId: job._id, ...(canSeeAllFollowUps(req.user) ? {} : { recruiterId: req.user._id }) }).sort({ createdAt: -1 }).lean();
    const snapshot = await getCandidateCommunicationSnapshot(candidates.map((candidate) => candidate._id), canSeeAllFollowUps(req.user) ? null : req.user._id);
    res.json({
      success: true,
      candidates: candidates.map((candidate) => buildCandidateSummary(candidate, snapshot.get(String(candidate._id)) || {})),
    });
  } catch (error) {
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

    const duplicate = await SourcedCandidate.findOne({
      requirementId: job._id,
      $or: [
        { email },
        { phoneNumber: phone },
      ],
    }).lean();
    if (duplicate) {
      return res.status(409).json({ success: false, message: "Candidate already exists for this requirement", duplicateCandidate: buildCandidateSummary(duplicate) });
    }

    const candidate = await SourcedCandidate.create({
      requirementId: job._id,
      recruiterId: req.user._id,
      resumeFileUrl: req.file.location || req.file.path,
      name: candidateName,
      email,
      phoneNumber: phone,
      sourceType: "Follow-up Upload",
    });
    logActivity(req.user._id, "created", "source-candidate", "Sourced candidate added from Follow-ups", candidate._id, "SourceCandidate", {
      actionType: "candidate_created",
      jobId: job._id,
      performedByRole: req.user.designation,
      metadata: { source: "recruiter_followups", sourceCandidateId: candidate._id },
    });
    res.status(201).json({ success: true, candidate: buildCandidateSummary(candidate.toObject()) });
  } catch (error) {
    console.error("Follow-up candidate create error:", error);
    res.status(500).json({ success: false, message: "Failed to add candidate" });
  }
});

router.post("/candidates/:candidateId/calls", async (req, res) => {
  try {
    const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
    if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
    const { callDate, callTime, status, outcome = "Other", notes = "", nextFollowUpDate, nextFollowUpTime, scheduleFollowUp, followUpType = "Call" } = req.body;
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
        notes: notes || `Follow-up after call status: ${status}`,
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
  const calls = await CallLog.find({ candidateId: candidate._id, ...ownerScope(req) }).sort({ createdAt: -1 }).lean();
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
  const followUps = await FollowUp.find({ candidateId: candidate._id, ...ownerScope(req) }).sort({ dueDate: 1, dueTime: 1 }).lean();
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

router.post("/candidates/:candidateId/email/generate", async (req, res) => {
  const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
  if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
  const category = EMAIL_CATEGORIES.includes(req.body.category) ? req.body.category : "Custom";
  const templates = makeGeneratedTemplates("EMAIL", category, candidate, job, req.user);
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
    const { subject, body, idempotencyKey } = req.body;
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return res.status(400).json({ success: false, message: "Invalid candidate email" });
    if (!subject || !body) return res.status(400).json({ success: false, message: "Subject and body are required" });
    if (idempotencyKey) {
      const existing = await Communication.findOne({ recruiterId: req.user._id, channel: "EMAIL", idempotencyKey });
      if (existing) return res.json({ success: true, communication: existing, duplicate: true });
    }
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
      const result = await sendMail({
        fromName: req.user.name || "Jobs Territory",
        from: req.user.email,
        to: recipient,
        subject,
        html: body.replace(/\n/g, "<br/>"),
        text: body,
        replyTo: req.user.email,
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
    res.status(500).json({ success: false, message: "Failed to send email" });
  }
});

router.post("/candidates/:candidateId/whatsapp/generate", async (req, res) => {
  const { candidate, job } = await assertCandidateAccess(req, req.params.candidateId);
  if (!candidate) return res.status(404).json({ success: false, message: "Candidate not found" });
  const category = WHATSAPP_CATEGORIES.includes(req.body.category) ? req.body.category : "Custom";
  const templates = makeGeneratedTemplates("WHATSAPP", category, candidate, job, req.user);
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
    const recipient = req.body.recipient || getCandidateField(candidate, ["phoneNumber", "Phone", "phone", "Mobile", "mobile"]);
    const { body, idempotencyKey } = req.body;
    if (!recipient) return res.status(400).json({ success: false, message: "Candidate phone number is required" });
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
      res.status(503).json({ success: false, code: error.code || "WHATSAPP_SEND_FAILED", message: error.message, communication });
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
