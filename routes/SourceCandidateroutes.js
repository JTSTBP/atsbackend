// Source Candidate wizard endpoint
const express = require("express");
const mongoose = require("mongoose");
const SourceCandidate = require("../models/SourceCandidate");
const Candidate = require("../models/CandidatesByJob");
const Job = require("../models/Jobs");
const User = require("../models/Users");
const upload = require("../middleware/upload");
const logActivity = require("./logactivity");
const router = express.Router();
const { getSignedUrl } = require('../config/s3Config');
const path = require('path');

// Load static data for skills and screening questions
const skillsData = require('../data/skills.json');
const screeningData = require('../data/screeningQuestions.json');

/**
 * Multi‑stage wizard for creating a source candidate.
 * Expected payload:
 *   { stage: Number, jobId, createdBy, ...other fields depending on stage }
 */
router.post("/", upload.single("resume"), async (req, res) => {
  try {
    // If stage is provided, it's the wizard. If not, it's a direct submission.
    const isWizard = !!req.body.stage;
    const stage = Number(req.body.stage) || 4; // Default to 4 (final stage) for direct submission
    const { jobId, createdBy } = req.body;
    
    // Backwards-compatible field mapping
    let dynamic = {};
    if (req.body.dynamicFields) {
      try {
        dynamic = typeof req.body.dynamicFields === 'string' ? JSON.parse(req.body.dynamicFields) : req.body.dynamicFields;
      } catch (e) {
        console.warn('Failed to parse dynamicFields JSON');
      }
    }
    
    // Find fields case-insensitively in dynamic object if not found directly
    const getDynField = (keys) => {
      for (const [k, v] of Object.entries(dynamic)) {
        if (keys.some(key => key.toLowerCase() === k.toLowerCase())) return v;
      }
      return '';
    };

    const fullName = req.body.fullName || req.body.fullname || req.body.candidateName || getDynField(['candidateName', 'fullName', 'name']) || '';
    const email = req.body.email || req.body.Email || getDynField(['Email']) || '';
    const phone = req.body.phone || req.body.Phone || getDynField(['Phone']) || '';
    const location = req.body.location || req.body.locationReferred || getDynField(['locationReferred', 'location']) || '';

    // Basic job/recruiter validation
    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const creator = await User.findById(createdBy);
    if (creator && creator.designation === "Recruiter" && job.status !== "Open") {
      return res.status(403).json({ success: false, message: `Job is not open for recruitment.` });
    }

    // Always do duplicate check for new candidates (stage 1 or direct submission)
    if (stage === 1 || !isWizard) {
      if (email || phone) {
        const queryOrSource = [];
        const queryOrRegular = [];
        
        if (email) {
          // Add regex for case-insensitive exact match
          const emailRegex = new RegExp(`^${email}$`, 'i');
          queryOrSource.push({ email: emailRegex });
          queryOrRegular.push({ "dynamicFields.Email": emailRegex });
          queryOrRegular.push({ "dynamicFields.email": emailRegex });
        }
        if (phone) {
          queryOrSource.push({ phone });
          queryOrRegular.push({ "dynamicFields.Phone": phone });
          queryOrRegular.push({ "dynamicFields.phone": phone });
        }
        
        let duplicateSource = null;
        let duplicateRegular = null;
        
        if (queryOrSource.length > 0) {
          duplicateSource = await SourceCandidate.findOne({ jobId, $or: queryOrSource });
        }
        
        if (!duplicateSource && queryOrRegular.length > 0) {
          duplicateRegular = await Candidate.findOne({ jobId, $or: queryOrRegular });
        }

        const duplicateObj = duplicateSource || duplicateRegular;

        if (duplicateObj) {
          const duplicateField = [];
          const foundEmail = duplicateObj.email || duplicateObj.dynamicFields?.Email || duplicateObj.dynamicFields?.email;
          const foundPhone = duplicateObj.phone || duplicateObj.dynamicFields?.Phone || duplicateObj.dynamicFields?.phone;
          
          if (email && foundEmail && String(foundEmail).toLowerCase() === String(email).toLowerCase()) {
            duplicateField.push("email");
          }
          if (phone && foundPhone && String(foundPhone) === String(phone)) {
            duplicateField.push("phone number");
          }
          
          const fieldMessage = duplicateField.length > 0 ? duplicateField.join(" and ") : "email or phone";
          return res.status(400).json({ success: false, message: `A candidate with this ${fieldMessage} already exists for the selected job.` });
        }
      }
    }

    // ------------------- Stage handling -------------------
    if (isWizard && stage === 1) {
      if (!fullName || !email || !phone || !location) {
        return res.status(400).json({ success: false, message: "Missing required personal details." });
      }
      return res.json({
        success: true,
        stage: 2,
        nextFields: {
          education: { type: "array", required: true },
          experience: { type: "string", required: true },
          lastCtc: { type: "string", required: false },
          expectedCtc: { type: "string", required: true },
          preferredLocation: { type: "string", required: false },
          requirements: { type: "string", required: false }
        }
      });
    }

    if (isWizard && stage === 2) {
      const { experience, skills } = req.body;
      if (!experience || !skills || (Array.isArray(skills) && skills.length === 0)) {
        return res.status(400).json({ success: false, message: "Experience and skills are mandatory." });
      }
      return res.json({
        success: true,
        stage: 3,
        nextFields: { projects: { type: "array", required: false } },
        screeningQuestions: screeningData
      });
    }

    if (isWizard && stage === 3) {
      return res.json({
        success: true,
        stage: 4
      });
    }

    if (!isWizard || stage === 4) {
      const {
        education, experience, experienceDetails, lastCtc, expectedCtc, preferredLocation, requirements,
        skills, projects
      } = req.body;

      // Extract previously sent fields from dynamic if needed
      let parsedExperience = experience || getDynField(['experience']);
      let parsedExpectedCtc = expectedCtc || getDynField(['expectedCtc']);
      let parsedPreviousCtc = lastCtc || req.body.previousCtc || getDynField(['previousCtc', 'lastCtc']);
      let parsedRequirements = requirements || getDynField(['requirements']);

      // Build candidate document
      const candidate = new SourceCandidate({
        jobId,
        createdBy,
        fullName,
        email,
        phone,
        locationReferred: location,
        experience: parsedExperience || 'N/A',
        experienceDetails: Array.isArray(experienceDetails) ? experienceDetails : [],
        education: Array.isArray(education) ? education : [],
        expectedCtc: parsedExpectedCtc || '0',
        previousCtc: parsedPreviousCtc,
        requirements: parsedRequirements || 'None',
        skills: Array.isArray(skills) ? skills : (skills ? [skills] : []),
        projects: projects || [],
        dynamicFields: dynamic,
        resumeUrl: req.file ? (req.file.location || req.file.path) : null
      });

      await candidate.save();

      logActivity(createdBy, "created", "source_candidate", `Created source candidate`, candidate._id, "SourceCandidate");
      await Job.findByIdAndUpdate(jobId, { $inc: { candidateCount: 1 } }, { new: true });

      const candidateObj = candidate.toObject();
      const candidateWithSignedUrl = { ...candidateObj, resumeUrl: getSignedUrl(candidateObj.resumeUrl) };

      return res.json({ success: true, candidate: candidateWithSignedUrl });
    }

    return res.status(400).json({ success: false, message: "Invalid stage value." });
  } catch (error) {
    console.error("Error in source candidate wizard:", error);
    return res.status(500).json({ success: false, message: "Server error while processing candidate wizard.", error: error.message });
  }
});

// GET all source candidates (unchanged)
router.get("/", async (req, res) => {
  try {
    const candidates = await SourceCandidate.find().populate("createdBy", "name email designation");
    const candidatesWithSigned = candidates.map(c => {
      const obj = c.toObject();
      obj.resumeUrl = getSignedUrl(obj.resumeUrl);
      return obj;
    });
    res.json({ success: true, candidates: candidatesWithSigned });
  } catch (error) {
    console.error("Error fetching source candidates:", error);
    res.status(500).json({ success: false, message: "Failed to fetch source candidates" });
  }
});

module.exports = router;
