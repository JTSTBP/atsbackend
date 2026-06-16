const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const upload = require("../middleware/upload");
const { protect } = require("../middleware/authMiddleware");
const SourcedCandidate = require("../models/SourcedCandidate");
const Job = require("../models/Jobs");
const { extractTextFromBuffer, parseResumeText } = require("../utils/resumeParser");

/**
 * @route   POST /api/source-candidates/upload
 * @desc    Upload candidate resume (PDF/DOC/DOCX)
 * @access  Private
 */
router.post("/upload", protect, upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No resume file uploaded" });
    }

    // Determine correct file path / URL
    const fileUrl = req.file.location || req.file.path;

    res.status(200).json({
      success: true,
      message: "Resume uploaded successfully",
      fileUrl: fileUrl,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype
    });
  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).json({ success: false, message: "Resume upload failed: " + error.message });
  }
});

/**
 * @route   POST /api/source-candidates/parse
 * @desc    Extract candidate details from resume
 * @access  Private
 */
router.post("/parse", protect, async (req, res) => {
  const { fileUrl, mimeType } = req.body;

  if (!fileUrl) {
    return res.status(400).json({ success: false, message: "File URL/path is required" });
  }

  try {
    let buffer;

    // Read buffer depending on S3/R2 vs local storage
    if (fileUrl.startsWith("http")) {
      const { hasCredentials, s3, extractBucketAndKey } = require("../config/s3Config");
      if (hasCredentials && s3) {
        const { bucket, key } = extractBucketAndKey(fileUrl);
        console.log(`Fetching file from cloud storage for parsing: Bucket=${bucket}, Key=${key}`);
        const s3Object = await s3.getObject({ Bucket: bucket, Key: key }).promise();
        buffer = s3Object.Body;
      } else {
        const response = await axios.get(fileUrl, { responseType: "arraybuffer" });
        buffer = Buffer.from(response.data);
      }
    } else {
      // Local path check
      const localPath = path.resolve(fileUrl);
      if (!fs.existsSync(localPath)) {
        return res.status(404).json({ success: false, message: "Uploaded file not found locally" });
      }
      buffer = fs.readFileSync(localPath);
    }

    const fileExtension = fileUrl.split('.').pop().toLowerCase();
    const text = await extractTextFromBuffer(buffer, mimeType || fileExtension);
    const parsedData = parseResumeText(text);

    res.status(200).json({
      success: true,
      data: parsedData
    });
  } catch (error) {
    console.error("Parsing Error:", error);
    res.status(500).json({ success: false, message: "Failed to parse resume: " + error.message });
  }
});

/**
 * @route   POST /api/source-candidates/save
 * @desc    Save a new sourced candidate to collection
 * @access  Private
 */
router.post("/save", protect, async (req, res) => {
  try {
    const {
      requirementId,
      resumeFileUrl,
      name,
      email,
      phoneNumber,
      education,
      skills,
      experience,
      workHistory,
      location,
      designation,
      currentCompany,
      previousCompanies,
      certifications,
      linkedinProfile,
      noticePeriod,
      expectedSalary
    } = req.body;

    const recruiterId = req.user._id;

    // Validation
    if (!requirementId) {
      return res.status(400).json({ success: false, message: "Requirement/Job ID is required" });
    }

    // Check if Job exists
    const job = await Job.findById(requirementId);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job/Requirement not found" });
    }

    // Require at least Name, Email, or Phone
    const hasName = name && name.trim().length > 0;
    const hasEmail = email && email.trim().length > 0;
    const hasPhone = phoneNumber && phoneNumber.trim().length > 0;

    if (!hasName && !hasEmail && !hasPhone) {
      return res.status(400).json({
        success: false,
        message: "Validation failed: Candidate must have at least a Name, Email, or Phone Number"
      });
    }

    const sourcedCandidate = new SourcedCandidate({
      recruiterId,
      requirementId,
      resumeFileUrl,
      name: name || null,
      email: email || null,
      phoneNumber: phoneNumber || null,
      education: education || null,
      skills: Array.isArray(skills) ? skills : [],
      experience: experience || null,
      workHistory: workHistory || null,
      location: location || null,
      designation: designation || null,
      currentCompany: currentCompany || null,
      previousCompanies: Array.isArray(previousCompanies) ? previousCompanies : [],
      certifications: Array.isArray(certifications) ? certifications : [],
      linkedinProfile: linkedinProfile || null,
      noticePeriod: noticePeriod || null,
      expectedSalary: expectedSalary || null,
      sourceType: "Resume Upload"
    });

    await sourcedCandidate.save();

    res.status(201).json({
      success: true,
      message: "Sourced candidate saved successfully!",
      candidate: {
        _id: sourcedCandidate._id,
        sourceIdentifier: sourcedCandidate.sourceIdentifier,
        ...sourcedCandidate.toObject()
      }
    });
  } catch (error) {
    console.error("Save Sourced Candidate Error:", error);
    res.status(500).json({ success: false, message: "Failed to save candidate: " + error.message });
  }
});

/**
 * @route   GET /api/source-candidates
 * @desc    Get all sourced candidates with optional filters
 * @access  Private
 */
router.get("/", protect, async (req, res) => {
  try {
    const {
      requirementId,
      search,
      location,
      minExp,
      maxExp,
      skills,
      company,
      designation,
      noticePeriod,
      sourceType,
      fromDate,
      toDate,
      page = "1",
      limit = "10"
    } = req.query;

    const numericPage = parseInt(page, 10) || 1;
    const numericLimit = parseInt(limit, 10) || 10;
    const skip = (numericPage - 1) * numericLimit;

    // Build filter object
    const filter = {};
    if (requirementId) filter.requirementId = requirementId;
    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { name: regex },
        { email: regex },
        { phoneNumber: regex },
        { skills: { $elemMatch: { $regex: regex } } }
      ];
    }
    if (location) filter.location = { $in: Array.isArray(location) ? location : [location] };
    if (company) filter.currentCompany = { $regex: company, $options: "i" };
    if (designation) filter.designation = { $regex: designation, $options: "i" };
    if (noticePeriod) filter.noticePeriod = noticePeriod;
    if (sourceType) filter.sourceType = sourceType;
    if (skills) {
      const skillArray = Array.isArray(skills) ? skills : (skills).split(",");
      filter.skills = { $all: skillArray };
    }
    if (minExp || maxExp) {
      // Placeholder for experience range filtering; adapt based on schema.
    }
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }

    // Restrict to recruiter unless admin
    if (req.user.designation === "Recruiter") {
      filter.recruiterId = req.user._id;
    }

    const totalCount = await SourcedCandidate.countDocuments(filter);
    const candidates = await SourcedCandidate.find(filter)
      .populate("recruiterId", "name email")
      .populate("requirementId", "title department status")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(numericLimit);

    res.status(200).json({
      success: true,
      candidates,
      totalCount,
      page: numericPage,
      limit: numericLimit
    });
  } catch (error) {
    console.error("Get Sourced Candidates Error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch candidates: " + error.message });
  }
});

module.exports = router;
