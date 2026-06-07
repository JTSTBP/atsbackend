// Source Candidate wizard endpoint
const express = require("express");
const mongoose = require("mongoose");
const SourceCandidate = require("../models/SourceCandidate");
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
    const stage = Number(req.body.stage) || 1;
    const { jobId, createdBy } = req.body;

    // Basic job/recruiter validation (shared for all stages)
    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    const creator = await User.findById(createdBy);
    if (creator && creator.designation === "Recruiter" && job.status !== "Open") {
      return res.status(403).json({ success: false, message: `Job is not open for recruitment.` });
    }

    // ------------------- Stage handling -------------------
    if (stage === 1) {
      // Personal details stage
      const { fullName, email, phone, location } = req.body;
      if (!fullName || !email || !phone || !location) {
        return res.status(400).json({ success: false, message: "Missing required personal details." });
      }
      // Duplicate check for same job
      const duplicate = await SourceCandidate.findOne({ jobId, $or: [{ email }, { phone }] });
      if (duplicate) {
        return res.json({ success: false, message: "A candidate with this email or phone already exists for the selected job." });
      }
      // Return next stage spec
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

    if (stage === 2) {
      // Education & experience stage
      const { education, experience, lastCtc, expectedCtc, preferredLocation, requirements } = req.body;
      if (!education || !experience || !expectedCtc) {
        return res.status(400).json({ success: false, message: "Missing required education/experience fields." });
      }
      // Return predefined skills for next stage
      return res.json({
        success: true,
        stage: 3,
        predefinedSkills: skillsData,
        nextFields: { skills: { type: "array", required: false } }
      });
    }

    if (stage === 3) {
      // Skills stage – nothing to validate, move on
      return res.json({
        success: true,
        stage: 4,
        nextFields: { projects: { type: "array", required: false } },
        screeningQuestions: screeningData
      });
    }

    if (stage === 4) {
      // Projects stage – optional, proceed to final creation
      const {
        fullName, email, phone, location,
        education, experience, lastCtc, expectedCtc, preferredLocation, requirements,
        skills, projects
      } = req.body;

      // Build candidate document
      const candidate = new SourceCandidate({
        jobId,
        createdBy,
        fullName,
        email,
        phone,
        location,
        education,
        experience,
        lastCtc,
        expectedCtc,
        preferredLocation,
        requirements,
        skills: skills || [],
        projects: projects || [],
        resumeUrl: req.file ? (req.file.location || req.file.path) : null
      });

      await candidate.save();

      // Log activity & increment job count
      logActivity(createdBy, "created", "source_candidate", `Created source candidate`, candidate._id, "SourceCandidate");
      await Job.findByIdAndUpdate(jobId, { $inc: { candidateCount: 1 } }, { new: true });

      const candidateObj = candidate.toObject();
      const candidateWithSignedUrl = { ...candidateObj, resumeUrl: getSignedUrl(candidateObj.resumeUrl) };

      return res.json({ success: true, candidate: candidateWithSignedUrl });
    }

    // If stage not recognized
    return res.status(400).json({ success: false, message: "Invalid stage value." });
  } catch (error) {
    console.error("Error in source candidate wizard:", error);
    return res.status(500).json({ success: false, message: "Server error while processing candidate wizard." });
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
