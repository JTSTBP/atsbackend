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
const { getSignedUrl } = require("../config/s3Config");

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

    const candidateObj = sourcedCandidate.toObject();
    if (candidateObj.resumeFileUrl) {
      candidateObj.resumeFileUrl = getSignedUrl(candidateObj.resumeFileUrl);
    }

    res.status(201).json({
      success: true,
      message: "Sourced candidate saved successfully!",
      candidate: {
        _id: sourcedCandidate._id,
        sourceIdentifier: sourcedCandidate.sourceIdentifier,
        ...candidateObj
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
      company,
      designation,
      noticePeriod,
      sourceType,
      fromDate,
      toDate,
      page = "1",
      limit = "10"
    } = req.query;

    const minExp = req.query.minExp;
    const maxExp = req.query.maxExp;
    const locationVal = req.query.location || req.query['location[]'];
    const skillsVal = req.query.skills || req.query['skills[]'];

    const numericPage = parseInt(page, 10) || 1;
    const numericLimit = parseInt(limit, 10) || 10;
    const skip = (numericPage - 1) * numericLimit;

    // Build filter object
    const filter = {};
    console.log('DEBUG: query params', JSON.stringify(req.query));
    console.log('DEBUG: initial filter', JSON.stringify(filter));
console.log('DEBUG FILTER:', JSON.stringify(filter));
    if (requirementId) filter.requirementId = requirementId;
    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      filter.$or = [
        { name: regex },
        { email: regex },
        { phoneNumber: regex },
        { skills: { $elemMatch: { $regex: regex } } }
      ];
    }
    if (locationVal) {
      const locArray = (Array.isArray(locationVal) ? locationVal : [locationVal])
        .map(loc => loc && loc.trim())
        .filter(Boolean);
      
      if (locArray.length > 0) {
        const locMapping = {
          'bengaluru': 'bengaluru|bangalore',
          'bangalore': 'bengaluru|bangalore',
          'delhi ncr': 'delhi|ncr|noida|gurgaon|ghaziabad',
          'mumbai': 'mumbai|bombay'
        };
        
        const mappedPatterns = locArray.map(loc => {
          const key = loc.toLowerCase();
          return locMapping[key] || key;
        });
        
        const regexPattern = mappedPatterns.join('|');
        filter.location = { $regex: regexPattern, $options: 'i' };
      }
    }
    if (company && company.trim()) filter.currentCompany = { $regex: company.trim(), $options: "i" };
    if (designation && designation.trim()) filter.designation = { $regex: designation.trim(), $options: "i" };
    if (noticePeriod && noticePeriod.trim()) filter.noticePeriod = noticePeriod.trim();
    if (sourceType && sourceType.trim()) filter.sourceType = sourceType.trim();
    if (skillsVal) {
      const skillArray = (Array.isArray(skillsVal) ? skillsVal : (skillsVal).split(","))
        .map(s => s && s.trim())
        .filter(Boolean);

      if (skillArray.length > 0) {
        const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.skills = { $all: skillArray.map(s => new RegExp(`^${escapeRegExp(s)}$`, "i")) };
      }
    }
        if ((fromDate && fromDate.trim()) || (toDate && toDate.trim())) {
          filter.createdAt = {};
          if (fromDate && fromDate.trim()) {
            // Use UTC start of day
            filter.createdAt.$gte = new Date(`${fromDate.trim()}T00:00:00.000Z`);
          }
          if (toDate && toDate.trim()) {
            // Use UTC end of day
            filter.createdAt.$lte = new Date(`${toDate.trim()}T23:59:59.999Z`);
          }
        }

    // Since we need to parse years of experience from arbitrary string formats,
    // we fetch matching candidate objects, apply the experience filter, and paginate.
    console.log('DEBUG: final filter before DB query', JSON.stringify(filter));
    const candidates = await SourcedCandidate.find(filter)
      .populate("recruiterId", "name email")
      .populate("requirementId", "title department status")
      .sort({ createdAt: -1 })
      .lean();

    // Sign URLs for cloud storage resumes
    candidates.forEach((candidate) => {
      if (candidate.resumeFileUrl) {
        candidate.resumeFileUrl = getSignedUrl(candidate.resumeFileUrl);
      }
    });

    let filtered = candidates;
    const hasMinExp = minExp && minExp.trim() && !isNaN(parseFloat(minExp));
    const hasMaxExp = maxExp && maxExp.trim() && !isNaN(parseFloat(maxExp));

    if (hasMinExp || hasMaxExp) {
      const parseExp = (expStr) => {
        if (!expStr) return 0;
        const cleaned = expStr.toLowerCase();
        const match = cleaned.match(/(\d+(?:\.\d+)?)/);
        if (!match) return 0;
        let val = parseFloat(match[1]);
        if (cleaned.includes("month") || cleaned.includes("mon")) {
          val = val / 12;
        }
        return val;
      };
      const minVal = hasMinExp ? parseFloat(minExp) : 0;
      const maxVal = hasMaxExp ? parseFloat(maxExp) : Infinity;
      
      filtered = candidates.filter(candidate => {
        const expVal = parseExp(candidate.experience);
        return expVal >= minVal && expVal <= maxVal;
      });
    }

    const totalCount = filtered.length;
    const paginatedCandidates = filtered.slice(skip, skip + numericLimit);

    res.status(200).json({
      success: true,
      candidates: paginatedCandidates,
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
