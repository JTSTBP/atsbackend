const express = require("express");
const Job = require("../models/Jobs");
const logActivity = require("./logactivity");
const Client = require("../models/Client");
const { getSignedUrl } = require("../config/s3Config");

const router = express.Router();

// ➕ Create a new job
router.post("/", async (req, res) => {
  try {
    const jobData = { ...req.body };
    delete jobData._id; // <-- remove _id if sent accidentally

    const newJob = new Job(jobData);
    await newJob.save();

    // Increment client's job count if clientId is provided
    if (newJob.clientId) {

      await Client.findByIdAndUpdate(newJob.clientId, {
        $inc: { jobCount: 1 }
      });
    }

    logActivity(
      req.body.CreatedBy, // userId
      "created", // action
      "job", // module
      `Created job ${newJob.title}`, // description
      newJob._id, // targetId
      "Job" // targetModel
    );
    res.status(201).json({ success: true, job: newJob });
  } catch (error) {
    console.error("Error creating job:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create job. Please check all required fields.",
    });
  }
});

const User = require("../models/Users"); // Ensure User model is imported
const Candidate = require("../models/CandidatesByJob");

// 📋 Get all jobs with Pagination & Filtering
router.get("/", async (req, res) => {
  try {
    const { page, limit, search, status, userId, role } = req.query;

    console.log("🔍 Jobs Request:", { page, limit, search, status, userId, role });

    // If no pagination params, use existing logic (backward compatibility)
    if (!page || !limit) {
      const jobs = await Job.find()
        .populate("assignedRecruiters", "name email")
        .populate("assignedMentors", "name email")
        .populate("leadRecruiter", "name email")
        .populate("CreatedBy", "name email")
        .populate("clientId", "companyName websiteUrl industry linkedinUrl companyInfo pocs logo")
        .sort({ createdAt: -1 });
      const jobsWithSignedLogos = jobs.map(job => {
        const jobObj = job.toObject();
        if (jobObj.clientId && jobObj.clientId.logo) {
          jobObj.clientId.logo = getSignedUrl(jobObj.clientId.logo);
        }
        return jobObj;
      });
      return res.json({ success: true, jobs: jobsWithSignedLogos });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build Query
    let andConditions = [];

    // 1️⃣ Status Filter
    if (status && status !== "all") {
      andConditions.push({ status });
    }

    // 2️⃣ Search Filter (Title, Dept, Location names)
    if (search) {
      const searchRegex = new RegExp(search, "i");
      andConditions.push({
        $or: [
          { title: searchRegex },
          { department: searchRegex },
          { employmentType: searchRegex },
          { "location.name": searchRegex }
        ]
      });
    }

    // 3️⃣ Client Search Filter
    if (req.query.clientSearch) {
      const clientSearchRegex = new RegExp(req.query.clientSearch, "i");
      const matchedClients = await Client.find({ companyName: clientSearchRegex }).select("_id");
      const matchedClientIds = matchedClients.map(c => c._id);
      andConditions.push({ clientId: { $in: matchedClientIds } });
    }

    // 4️⃣ Role-Based Filtering
    if (role) {
      const userRole = role.toLowerCase();

      if (userRole === "admin") {
        // Admin sees all - no extra filter
      }
      else if (userRole === "mentor") {
        // Mentor sees their own jobs OR jobs they are assigned to
        // OR jobs assigned to any of their reportees (recruiters)
        if (userId) {
          const reportees = await User.find({ reporter: userId }).select("_id");
          const reporteeIds = reportees.map(u => u._id);
          const allowedIds = [userId, ...reporteeIds];

          andConditions.push({
            $or: [
              { CreatedBy: userId },
              { assignedMentors: userId },
              { assignedRecruiters: { $in: allowedIds } }
            ]
          });
        }
      }
      else if (userRole === "manager") {
        // Manager strictly sees jobs CREATED BY or ASSIGNED TO Manager + Mentors (direct reportees)
        // OR ASSIGNED TO any of their entire team (Mentors + Recruiters) via assignedRecruiters
        if (userId) {
          const directMentors = await User.find({ reporter: userId, designation: "Mentor" }).select("_id");
          const mentorIds = directMentors.map(u => u._id);
          const mentorAllowedIds = [userId, ...mentorIds];

          // Sub-reportees for recruiters
          const subReportees = await User.find({ reporter: { $in: mentorAllowedIds } }).select("_id");
          const allReporteeIds = [...new Set([...mentorAllowedIds, ...subReportees.map(u => u._id)])];

          andConditions.push({
            $or: [
              { CreatedBy: { $in: mentorAllowedIds } },
              { assignedMentors: { $in: mentorAllowedIds } },
              { assignedRecruiters: { $in: allReporteeIds } }
            ]
          });
        }
      }
    }

    const query = andConditions.length > 0 ? { $and: andConditions } : {};

    // Execute Query with Pagination
    const jobs = await Job.find(query)
      .sort({ createdAt: -1 })
      .populate("assignedRecruiters", "name email")
      .populate("assignedMentors", "name email")
      .populate("leadRecruiter", "name email")
      .populate("CreatedBy", "name email")
      .populate("clientId", "companyName websiteUrl industry linkedinUrl companyInfo pocs logo")
      .skip(skip)
      .limit(limitNum)
      .lean();

    const totalJobs = await Job.countDocuments(query);

    // 📊 AGGREGATE STATS (New & Shortlisted Counts)
    const jobIds = jobs.map(job => job._id);

    const stats = await Candidate.aggregate([
      { $match: { jobId: { $in: jobIds } } },
      {
        $group: {
          _id: "$jobId",
          newCount: {
            $sum: { $cond: [{ $eq: ["$status", "New"] }, 1, 0] }
          },
          shortlistedCount: {
            $sum: { $cond: [{ $eq: ["$status", "Shortlisted"] }, 1, 0] }
          },
          interviewedCount: {
            $sum: { $cond: [{ $eq: ["$status", "Interviewed"] }, 1, 0] }
          },
          selectedCount: {
            $sum: { $cond: [{ $eq: ["$status", "Selected"] }, 1, 0] }
          },
          joinedCount: {
            $sum: { $cond: [{ $eq: ["$status", "Joined"] }, 1, 0] }
          },
          totalCount: { $sum: 1 }
        }
      }
    ]);

    // Map stats to jobs
    const jobsWithStats = jobs.map(job => {
      const stat = stats.find(s => s._id.toString() === job._id.toString());
      const jobObj = {
        ...job,
        newResponses: stat ? stat.newCount : 0,
        shortlisted: stat ? stat.shortlistedCount : 0,
        interviewed: stat ? stat.interviewedCount : 0,
        selected: stat ? stat.selectedCount : 0,
        joined: stat ? stat.joinedCount : 0,
        candidateCount: stat ? stat.totalCount : (job.candidateCount || 0)
      };
      
      if (jobObj.clientId && jobObj.clientId.logo) {
        jobObj.clientId.logo = getSignedUrl(jobObj.clientId.logo);
      }
      
      return jobObj;
    });

    res.json({
      success: true,
      jobs: jobsWithStats,
      totalJobs,
      totalPages: Math.ceil(totalJobs / limitNum),
      currentPage: pageNum
    });

  } catch (error) {
    console.error("Error fetching jobs:", error);
    res.status(500).json({ success: false, message: "Failed to fetch jobs" });
  }
});

// 📋 Get all jobs created by a specific user (CreatedBy)
router.get("/createdby/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const jobs = await Job.find({ CreatedBy: userId })
      .populate("assignedRecruiters", "name email")
      .populate("assignedMentors", "name email")
      .populate("leadRecruiter", "name email")
      .populate("CreatedBy", "name email")
      .populate("clientId", "companyName websiteUrl industry linkedinUrl companyInfo pocs logo")
      .sort({ createdAt: -1 });

    if (!jobs.length) {
      return res.status(404).json({
        success: false,
        message: "No jobs found for this user",
      });
    }

    const jobsWithSignedLogos = jobs.map(job => {
      const jobObj = job.toObject();
      if (jobObj.clientId && jobObj.clientId.logo) {
        jobObj.clientId.logo = getSignedUrl(jobObj.clientId.logo);
      }
      return jobObj;
    });

    res.json({ success: true, jobs: jobsWithSignedLogos });
  } catch (error) {
    console.error("Error fetching jobs by creator:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch jobs by CreatedBy",
    });
  }
});

// 🎯 Get jobs assigned to a specific recruiter
router.get("/assigned/:recruiterId", async (req, res) => {
  try {
    const { recruiterId } = req.params;
    const { page, limit, search, status } = req.query;

    console.log("🔍 Assigned Jobs Request:", { recruiterId, page, limit, search, status });

    const query = { assignedRecruiters: recruiterId };

    // 1️⃣ Status Filter
    if (status && status !== "all" && status !== "All") {
      query.status = status;
    }

    // 2️⃣ Search Filter (Title, Dept)
    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [
        { title: searchRegex },
        { department: searchRegex }
      ];
    }

    // 3️⃣ Client Search Filter
    if (req.query.clientSearch) {
      const clientSearchRegex = new RegExp(req.query.clientSearch, "i");
      const matchedClients = await Client.find({ companyName: clientSearchRegex }).select("_id");
      const matchedClientIds = matchedClients.map(c => c._id);

      if (query.$or) {
        query = {
          $and: [
            { $or: query.$or },
            { clientId: { $in: matchedClientIds } }
          ],
          ...Object.fromEntries(Object.entries(query).filter(([key]) => key !== '$or'))
        };
      } else {
        query.clientId = { $in: matchedClientIds };
      }
    }

    // Backward compatibility: If no pagination, return all
    if (!page || !limit) {
      const jobs = await Job.find(query)
        .populate("assignedRecruiters", "name email")
        .populate("assignedMentors", "name email")
        .populate("leadRecruiter", "name email")
        .populate("CreatedBy", "name email")
        .populate("clientId", "companyName websiteUrl industry linkedinUrl companyInfo pocs logo")
        .sort({ createdAt: -1 });
      const jobsWithSignedLogos = jobs.map(job => {
        const jobObj = job.toObject();
        if (jobObj.clientId && jobObj.clientId.logo) {
          jobObj.clientId.logo = getSignedUrl(jobObj.clientId.logo);
        }
        return jobObj;
      });
      return res.json({ success: true, jobs: jobsWithSignedLogos });
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const jobs = await Job.find(query)
      .populate("assignedRecruiters", "name email")
      .populate("assignedMentors", "name email")
      .populate("leadRecruiter", "name email")
      .populate("CreatedBy", "name email")
      .populate("clientId", "companyName websiteUrl industry linkedinUrl companyInfo pocs logo")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const totalJobs = await Job.countDocuments(query);

    const jobsWithSignedLogos = jobs.map(job => {
      const jobObj = job.toObject();
      if (jobObj.clientId && jobObj.clientId.logo) {
        jobObj.clientId.logo = getSignedUrl(jobObj.clientId.logo);
      }
      return jobObj;
    });

    res.json({
      success: true,
      jobs: jobsWithSignedLogos,
      totalJobs,
      totalPages: Math.ceil(totalJobs / limitNum),
      currentPage: pageNum
    });

  } catch (error) {
    console.error("Error fetching assigned jobs:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch assigned jobs",
    });
  }
});

// 🧾 Get Single Job
router.get("/:id", async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate("assignedRecruiters", "name email")
      .populate("assignedMentors", "name email")
      .populate("leadRecruiter", "name email")
      .populate("clientId", "companyName websiteUrl industry linkedinUrl companyInfo pocs logo")

    if (!job)
      return res.status(404).json({ success: false, message: "Job not found" });

    const jobObj = job.toObject();
    if (jobObj.clientId && jobObj.clientId.logo) {
      jobObj.clientId.logo = getSignedUrl(jobObj.clientId.logo);
    }

    res.json({ success: true, job: jobObj });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch job" });
  }
});

// ✏️ Update a job
router.put("/:id", async (req, res) => {
  try {
    console.log(req.body, "uuu");
    const oldJob = await Job.findById(req.params.id);
    if (!oldJob) {
      return res.status(404).json({ success: false, message: "Job not found" });
    }

    const updatedJob = await Job.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    })
      .populate("assignedRecruiters", "name email")
      .populate("assignedMentors", "name email")
      .populate("leadRecruiter", "name email")
      .populate("CreatedBy", "name email")
      .populate("clientId", "companyName websiteUrl industry linkedinUrl companyInfo pocs logo");

    // Handle Client Job Count Update
    if (req.body.clientId && req.body.clientId !== (oldJob.clientId?.toString())) {
      // Decrement count for old client
      if (oldJob.clientId) {
        await Client.findByIdAndUpdate(oldJob.clientId, {
          $inc: { jobCount: -1 }
        });
      }
      // Increment count for new client
      await Client.findByIdAndUpdate(req.body.clientId, {
        $inc: { jobCount: 1 }
      });
    } else if (req.body.clientId === "" && oldJob.clientId) {
      // If client is removed
      await Client.findByIdAndUpdate(oldJob.clientId, {
        $inc: { jobCount: -1 }
      });
    }
    logActivity(
      req.body.UpdatedBy, // userId (you must send updatedBy from frontend)
      "updated", // action
      "job", // module
      `Updated job ${updatedJob.title}`, // description
      updatedJob._id, // targetId
      "Job" // targetModel
    );
    const jobObj = updatedJob.toObject();
    if (jobObj.clientId && jobObj.clientId.logo) {
      jobObj.clientId.logo = getSignedUrl(jobObj.clientId.logo);
    }
    
    res.json({ success: true, job: jobObj });
  } catch (error) {
    console.error("Error updating job:", error);
    res.status(500).json({ success: false, message: "Failed to update job" });
  }
});

// ❌ Delete a job
router.delete("/:id/:role", async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id);
    logActivity(
      req.params.role, // userId (role param actually contains userId)
      "deleted", // action
      "job", // module
      `Deleted job`, // description
      req.params.id, // targetId
      "Job" // targetModel
    );
    res.json({ success: true, message: "Job deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to delete job" });
  }
});

module.exports = router;
