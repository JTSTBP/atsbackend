const express = require("express");
const mongoose = require("mongoose");
const SourceCandidate = require("../models/SourceCandidate");
const Job = require("../models/Jobs");
const User = require("../models/Users");
const upload = require("../middleware/upload");
const logActivity = require("./logactivity");
const router = express.Router();
const { getSignedUrl } = require('../config/s3Config');

// 🟢 Create a new source candidate
router.post("/", upload.single("resume"), async (req, res) => {
  try {
    const parsedFields = req.body.dynamicFields
      ? JSON.parse(req.body.dynamicFields)
      : {};

    const { jobId, createdBy, locationReferred, experience, expectedCtc, previousCtc, requirements } = req.body;

    // 1️⃣ Check if job exists
    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found. Please select a valid job.",
      });
    }

    // 1.1️⃣ Check if user is a recruiter and if the job is open
    const creator = await User.findById(createdBy);
    if (creator && creator.designation === "Recruiter" && job.status !== "Open") {
      return res.status(403).json({
        success: false,
        message: `Candidates cannot be added to a job with '${job.status}' status. Only 'Open' jobs are available for recruitment.`,
      });
    }

    // 3️⃣ Create the source candidate
    const candidate = new SourceCandidate({
      jobId,
      createdBy,
      linkedinUrl: req.body.linkedinUrl || "",
      portfolioUrl: req.body.portfolioUrl || "",
      notes: req.body.notes || "",
      dynamicFields: parsedFields,
      locationReferred: locationReferred || "",
      experience: experience || "",
      expectedCtc: expectedCtc || "",
      previousCtc: previousCtc || "",
      requirements: requirements || "",
      resumeUrl: req.file ? (req.file.location || req.file.path) : null, // S3 URL or local path
    });

    await candidate.save();
    
    // Activity Log
    logActivity(
      createdBy,
      "created",
      "source_candidate",
      `Created source candidate`,
      candidate._id,
      "SourceCandidate"
    );

    if (jobId) {
      await Job.findByIdAndUpdate(
        jobId,
        { $inc: { candidateCount: 1 } },
        { new: true }
      );
    }

    const candidateObj = candidate.toObject();
    const candidateWithSignedUrl = {
      ...candidateObj,
      resumeUrl: getSignedUrl(candidateObj.resumeUrl)
    };

    res.json({ success: true, candidate: candidateWithSignedUrl });

  } catch (error) {
    console.error("Error creating source candidate:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create source candidate",
    });
  }
});

// GET all source candidates
router.get("/", async (req, res) => {
  try {
    const candidates = await SourceCandidate.find();
    const candidatesWithSigned = candidates.map((c) => {
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
