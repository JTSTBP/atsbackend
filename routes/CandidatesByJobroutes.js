const express = require("express");
const mongoose = require("mongoose");
const Candidate = require("../models/CandidatesByJob");
const Job = require("../models/Jobs");
const User = require("../models/Users");
const upload = require("../middleware/upload");
const offerLetterUpload = require("../middleware/offerLetterUpload");
const router = express.Router();
const logActivity = require("./logactivity");
const nodemailer = require("nodemailer");
const fs = require('fs');
const path = require('path');
const { s3, getSignedUrl, deleteFile } = require('../config/s3Config');


// Helper function to send email notification to mentor when a candidate is created
async function sendCreateNotificationToMentor(recruiterId, candidateName, jobTitle) {
  try {
    console.log('📧 Attempting to send creation email notification...', {
      recruiterId,
      candidateName,
      jobTitle
    });

    // Get the recruiter with reporter (mentor) populated
    const recruiter = await User.findById(recruiterId).populate('reporter', 'name email');

    if (!recruiter) {
      console.log(`❌ Recruiter not found for ID: ${recruiterId}`);
      return;
    }

    console.log('👤 Recruiter Details:', {
      userId: recruiter._id,
      userName: recruiter.name,
      email: recruiter.email,
      hasReporter: !!recruiter.reporter,
      reporterName: recruiter.reporter?.name,
      reporterEmail: recruiter.reporter?.email,
      hasAppPassword: !!recruiter.appPassword,
      appPasswordLength: recruiter.appPassword ? recruiter.appPassword.length : 0
    });

    if (!recruiter.reporter || !recruiter.reporter.email) {
      console.log('⚠️ No reporter found for this recruiter or reporter has no email');
      return;
    }

    // Check if recruiter has appPassword configured
    if (!recruiter.appPassword) {
      console.log(`⚠️ Recruiter ${recruiter.name} has no app password configured. Please set it in profile to enable notifications.`);
      return;
    }


    const mentor = recruiter.reporter;

    // Create email transporter using recruiter's credentials
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: recruiter.email,
        pass: recruiter.appPassword,
      },
    });

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h2 style="color: #2c3e50; margin-bottom: 20px; border-bottom: 3px solid #3498db; padding-bottom: 10px;">
            🆕 New Candidate Uploaded
          </h2>
          
          <div style="margin-bottom: 20px;">
            <p style="margin: 5px 0;"><strong>Recruiter:</strong> ${recruiter.name}</p>
            <p style="margin: 5px 0;"><strong>Candidate Name:</strong> ${candidateName}</p>
            <p style="margin: 5px 0;"><strong>Job Position:</strong> ${jobTitle}</p>
          </div>

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #7f8c8d; font-size: 12px;">
            <p>This is an automated notification. Please do not reply to this email.</p>
          </div>
        </div>
      </div>
    `;

    const mailOptions = {
      from: recruiter.email,
      to: mentor.email,
      subject: `New Candidate Created: ${candidateName} by ${recruiter.name}`,
      html: htmlContent,
    };

    console.log('📨 Sending email to mentor:', mentor.email);
    await transporter.sendMail(mailOptions);
    console.log(`✅ Email notification sent successfully to ${mentor.email}`);
  } catch (error) {
    console.error('❌ Error sending creation email notification:', error);
  }
}

// Helper function to send email notification to reporter
async function sendUpdateNotificationToReporter(updatingUserId, candidateName, jobTitle, changes) {

  try {
    console.log('📧 Attempting to send email notification...', {
      updatingUserId,
      candidateName,
      jobTitle,
      changesCount: changes.length
    });

    // Get the updating user with reporter populated
    const updatingUser = await User.findById(updatingUserId).populate('reporter', 'name email appPassword');

    console.log('👤 Updating user found:', {
      userId: updatingUser?._id,
      userName: updatingUser?.name,
      hasReporter: !!updatingUser?.reporter,
      reporterEmail: updatingUser?.reporter?.email,
      reporterHasAppPassword: !!updatingUser?.reporter?.appPassword
    });

    if (!updatingUser || !updatingUser.reporter || !updatingUser.reporter.email) {
      console.log('⚠️ No reporter found or reporter has no email');
      return;
    }

    const reporter = updatingUser.reporter;

    // Check if reporter has appPassword configured
    if (!reporter.appPassword) {
      console.log('⚠️ Reporter has no app password configured');
      return;
    }

    // Create email transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: reporter.email,
        pass: reporter.appPassword,
      },
    });

    // Build changes table
    let changesHtml = '';
    changes.forEach(change => {
      changesHtml += `
        <tr>
          <td style="padding: 10px; border: 1px solid #ddd; font-weight: 500;">${change.field}</td>
          <td style="padding: 10px; border: 1px solid #ddd; color: #dc3545;">${change.oldValue || 'N/A'}</td>
          <td style="padding: 10px; border: 1px solid #ddd; color: #28a745;">${change.newValue || 'N/A'}</td>
        </tr>
      `;
    });

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h2 style="color: #2c3e50; margin-bottom: 20px; border-bottom: 3px solid #3498db; padding-bottom: 10px;">
            📝 Candidate Update Notification
          </h2>
          
          <div style="margin-bottom: 20px;">
            <p style="margin: 5px 0;"><strong>Updated By:</strong> ${updatingUser.name}</p>
            <p style="margin: 5px 0;"><strong>Candidate:</strong> ${candidateName}</p>
            <p style="margin: 5px 0;"><strong>Job Position:</strong> ${jobTitle}</p>
          </div>

          <h3 style="color: #34495e; margin-top: 25px; margin-bottom: 15px;">Changes Made:</h3>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <thead>
              <tr style="background-color: #f8f9fa;">
                <th style="padding: 12px; border: 1px solid #ddd; text-align: left; color: #495057;">Field</th>
                <th style="padding: 12px; border: 1px solid #ddd; text-align: left; color: #495057;">Previous Value</th>
                <th style="padding: 12px; border: 1px solid #ddd; text-align: left; color: #495057;">New Value</th>
              </tr>
            </thead>
            <tbody>
              ${changesHtml}
            </tbody>
          </table>

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #7f8c8d; font-size: 12px;">
            <p>This is an automated notification. Please do not reply to this email.</p>
          </div>
        </div>
      </div>
    `;

    const mailOptions = {
      from: reporter.email,
      to: reporter.email,
      subject: `Candidate Updated: ${candidateName} - ${jobTitle}`,
      html: htmlContent,
    };

    console.log('📨 Sending email to:', reporter.email);
    await transporter.sendMail(mailOptions);
    console.log(`✅ Email notification sent successfully to ${reporter.email}`);
  } catch (error) {
    console.error('❌ Error sending email notification:', error);
    // Don't throw error - we don't want email failures to block the update
  }
}

// 🔵 Get all candidates (with Pagination & Filtering)
router.get("/", async (req, res) => {
  try {
    const { page, limit, search, status, client, jobTitle, stage, startDate, endDate, reporterId, recruiterId, jobStatus, joinStartDate, joinEndDate, selectStartDate, selectEndDate } = req.query;

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    console.log("🔍 Candidates Filter Request:", {
      page, limit, search, status, client, jobTitle, stage, startDate, endDate, reporterId, jobStatus
    });

    // Base Match Stage (for direct fields)
    const matchStage = {};

    // Filter by Status
    if (status && status !== "all") {
      matchStage.status = new RegExp(`^${status}$`, "i");
    }

    // Filter by Interview Stage
    if (stage && stage !== "all") {
      matchStage.interviewStage = stage;
    }

    // Search (Candidate Name, Email, Phone, Skills) - stored in dynamicFields
    if (search) {
      const searchRegex = new RegExp(search, "i");
      matchStage.$or = [
        { "dynamicFields.candidateName": searchRegex },
        { "dynamicFields.CandidateName": searchRegex }, // Handle potential case differences
        { "dynamicFields.Email": searchRegex },
        { "dynamicFields.email": searchRegex },
        { "dynamicFields.Phone": searchRegex },
        { "dynamicFields.phone": searchRegex },
        { "dynamicFields.Skills": searchRegex },
        { "dynamicFields.skills": searchRegex }
      ];
    }

    // Aggregation Pipeline
    const isStatusAll = !status || status === "all";

    const pipeline = [
      // 1. Compute relevantTimestamp based on whether a specific status is selected
      ...(startDate || endDate ? [
        // Only add the $addFields + $match if date filtering is needed
        ...(isStatusAll ? [
          // Status = "all" → filter directly by createdAt
          {
            $match: {
              createdAt: {
                ...(startDate ? { $gte: new Date(startDate) } : {}),
                ...(endDate ? { $lte: (() => { const d = new Date(endDate); d.setHours(23, 59, 59, 999); return d; })() } : {})
              }
            }
          }
        ] : [
          // Specific status selected → compute relevantTimestamp from statusHistory
          {
            $addFields: {
              relevantTimestamp: {
                $switch: {
                  branches: [
                    {
                      case: {
                        $and: [
                          { $eq: [status, "Selected"] },
                          { $ne: ["$selectionDate", null] }
                        ]
                      },
                      then: "$selectionDate"
                    },
                    {
                      case: {
                        $and: [
                          { $eq: [status, "Joined"] },
                          { $ne: ["$joiningDate", null] }
                        ]
                      },
                      then: "$joiningDate"
                    }
                  ],
                  default: {
                    $let: {
                      vars: {
                        historyMatch: {
                          $arrayElemAt: [
                            {
                              $filter: {
                                input: { $ifNull: ["$statusHistory", []] },
                                as: "h",
                                cond: (["Shortlisted", "Screen", "Screened"].includes(status))
                                  ? { $in: ["$$h.status", ["Shortlisted", "Screen", "Screened"]] }
                                  : { $eq: ["$$h.status", status] }
                              }
                            },
                            -1
                          ]
                        }
                      },
                      in: {
                        $cond: [
                          { $not: ["$$historyMatch"] },
                          "$createdAt",
                          "$$historyMatch.timestamp"
                        ]
                      }
                    }
                  }
                }
              }
            }
          },
          {
            $match: {
              relevantTimestamp: {
                ...(startDate ? { $gte: new Date(startDate) } : {}),
                ...(endDate ? { $lte: (() => { const d = new Date(endDate); d.setHours(23, 59, 59, 999); return d; })() } : {})
              }
            }
          }
        ])
      ] : []),

      // 3. Filter by Joined/Selected specific ranges if provided
      ...(joinStartDate || joinEndDate ? [{
        $match: {
          joiningDate: {
            ...(joinStartDate ? { $gte: new Date(joinStartDate) } : {}),
            ...(joinEndDate ? { $lte: (() => { const d = new Date(joinEndDate); d.setHours(23, 59, 59, 999); return d; })() } : {})
          }
        }
      }] : []),
      ...(selectStartDate || selectEndDate ? [{
        $match: {
          selectionDate: {
            ...(selectStartDate ? { $gte: new Date(selectStartDate) } : {}),
            ...(selectEndDate ? { $lte: (() => { const d = new Date(selectEndDate); d.setHours(23, 59, 59, 999); return d; })() } : {})
          }
        }
      }] : []),

      // 4. Base filtering (Status, Stage, Search)
      { $match: matchStage },
      { $sort: { createdAt: -1 } },

      // Lookup Job
      {
        $lookup: {
          from: "jobs",
          localField: "jobId",
          foreignField: "_id",
          as: "job"
        }
      },
      { $unwind: { path: "$job", preserveNullAndEmptyArrays: true } },

      // Lookup Client (via Job)
      {
        $lookup: {
          from: "clients",
          localField: "job.clientId",
          foreignField: "_id",
          as: "client"
        }
      },
      { $unwind: { path: "$client", preserveNullAndEmptyArrays: true } },

      // Lookup CreatedBy User
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "creator"
        }
      },
      { $unwind: { path: "$creator", preserveNullAndEmptyArrays: true } },

      // Lookup Creator's Reporter
      {
        $lookup: {
          from: "users",
          localField: "creator.reporter",
          foreignField: "_id",
          as: "reporter"
        }
      },
      { $unwind: { path: "$reporter", preserveNullAndEmptyArrays: true } },

      // Relational Filtering (Client & Job Title)
      {
        $match: {
          ...(client && client !== "all" ? { "client.companyName": new RegExp(client, "i") } : {}),
          ...(jobTitle && jobTitle !== "all" ? { "job.title": new RegExp(jobTitle, "i") } : {}),
          ...(reporterId && reporterId !== "all" ? { "reporter._id": new mongoose.Types.ObjectId(reporterId) } : {}),
          ...(recruiterId && recruiterId !== "all" ? { "creator._id": new mongoose.Types.ObjectId(recruiterId) } : {}),
          ...(jobStatus && jobStatus !== "all" ? { "job.status": jobStatus } : {})
        }
      }
    ];

    // If Pagination is Requested
    if (page && limit) {
      const result = await Candidate.aggregate([
        ...pipeline,
        {
          $facet: {
            candidates: [
              { $skip: skip },
              { $limit: limitNum },
              // Project to restore original structure expected by frontend (nested objects)
              {
                $project: {
                  _id: 1,
                  dynamicFields: 1,
                  resumeUrl: 1,
                  status: 1,
                  interviewStage: 1,
                  joiningDate: 1,
                  offerLetter: 1,
                  selectionDate: 1,
                  expectedJoiningDate: 1,
                  createdAt: 1,
                  notes: 1,
                  rejectionReason: 1,
                  rejectedBy: 1,
                  droppedBy: 1,
                  linkedinUrl: 1,
                  portfolioUrl: 1,
                  interviewStageHistory: 1,
                  statusHistory: 1,
                  comments: 1,
                  // Reconstruct jobId object
                  jobId: {
                    _id: "$job._id",
                    title: "$job.title",
                    status: "$job.status",
                    stages: "$job.stages",
                    clientId: {
                      _id: "$client._id",
                      companyName: "$client.companyName"
                    }
                  },
                  // Reconstruct createdBy object
                  createdBy: {
                    _id: "$creator._id",
                    name: "$creator.name",
                    designation: "$creator.designation",
                    reporter: {
                      _id: "$reporter._id",
                      name: "$reporter.name"
                    }
                  }
                }
              }
            ],
            totalCount: [{ $count: "count" }]
          }
        }
      ]);

      const candidates = result[0].candidates.map(candidate => ({
        ...candidate,
        resumeUrl: getSignedUrl(candidate.resumeUrl),
        offerLetter: getSignedUrl(candidate.offerLetter)
      }));
      const totalCandidates = result[0].totalCount[0] ? result[0].totalCount[0].count : 0;

      return res.json({
        success: true,
        candidates,
        totalCandidates,
        totalPages: Math.ceil(totalCandidates / limitNum),
        currentPage: pageNum
      });
    }

    // Default: Return All (Backward Compatibility - utilizing basic find for simpler structure if no complex filters)
    // NOTE: The previous implementation used standard populate. If we want to support the same rich population without pagination, we can fall back to the original method or use the pipeline without skip/limit.
    // However, to keep it safe and consistent with previous behavior (populating EVERYTHING), let's stick to the Mongoose find() for the default case,
    // OR we can use the pipeline with no limit. 
    // Given the complexity of the previous populations (nested deep), let's FALLBACK to the original Mongoose Find for non-paginated requests to modify as little risk as possible.

    const candidates = await Candidate.find()
      .populate({
        path: "createdBy",
        select: "name email reporter designation",
        populate: {
          path: "reporter",
          select: "name email role",
        },
      })
      .populate({
        path: "jobId",
        select: "title _id clientId",
        populate: {
          path: "clientId",
          select: "companyName"
        }
      })
      .populate({
        path: "interviewStageHistory.updatedBy",
        select: "name email designation",
      })
      .populate({
        path: "statusHistory.updatedBy",
        select: "name email designation",
      })
      .sort({ createdAt: -1 });

    const candidatesWithSignedUrls = candidates.map(candidate => {
      const candidateObj = candidate.toObject();
      return {
        ...candidateObj,
        resumeUrl: getSignedUrl(candidateObj.resumeUrl),
        offerLetter: getSignedUrl(candidateObj.offerLetter)
      };
    });

    res.json({ success: true, candidates: candidatesWithSignedUrls });

  } catch (error) {
    console.error("Error fetching candidates:", error);
    res.status(500).json({ success: false, message: "Failed to fetch candidates" });
  }
});

// 🟢 Create a new candidate
router.post("/", upload.single("resume"), async (req, res) => {
  try {
    const parsedFields = req.body.dynamicFields
      ? JSON.parse(req.body.dynamicFields)
      : {};

    const { jobId } = req.body;

    // 1️⃣ Check if job exists
    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found. Please select a valid job.",
      });
    }

    // 1.1️⃣ Check if user is a recruiter and if the job is open
    const creator = await User.findById(req.body.createdBy);
    if (creator && creator.designation === "Recruiter" && job.status !== "Open") {
      return res.status(403).json({
        success: false,
        message: `Candidates cannot be added to a job with '${job.status}' status. Only 'Open' jobs are available for recruitment.`,
      });
    }

    // 2️⃣ Check for duplicate candidate (same email or phone for this job)
    const email = parsedFields.Email || parsedFields.email;
    const phone = parsedFields.Phone || parsedFields.phone;

    if (email || phone) {
      const duplicateQuery = {
        jobId: jobId,
        $or: [],
      };

      if (email) {
        duplicateQuery.$or.push({
          $or: [
            { "dynamicFields.Email": email },
            { "dynamicFields.email": email },
          ],
        });
      }

      if (phone) {
        duplicateQuery.$or.push({
          $or: [
            { "dynamicFields.Phone": phone },
            { "dynamicFields.phone": phone },
          ],
        });
      }

      const existingCandidate = await Candidate.findOne(duplicateQuery);

      if (existingCandidate) {
        const duplicateField = [];
        if (email && (existingCandidate.dynamicFields?.Email === email || existingCandidate.dynamicFields?.email === email)) {
          duplicateField.push("email");
        }
        if (phone && (existingCandidate.dynamicFields?.Phone === phone || existingCandidate.dynamicFields?.phone === phone)) {
          duplicateField.push("phone");
        }

        return res.status(400).json({
          success: false,
          message: `A candidate with the same ${duplicateField.join(" and ")} already exists for this job.`,
          duplicateCandidate: {
            name: existingCandidate.dynamicFields?.candidateName || existingCandidate.dynamicFields?.CandidateName,
            email: existingCandidate.dynamicFields?.Email || existingCandidate.dynamicFields?.email,
            phone: existingCandidate.dynamicFields?.Phone || existingCandidate.dynamicFields?.phone,
          },
        });
      }
    }

    // 3️⃣ Create the candidate if no duplicates found
    const candidate = new Candidate({
      jobId: req.body.jobId,
      createdBy: req.body.createdBy,
      linkedinUrl: req.body.linkedinUrl,
      portfolioUrl: req.body.portfolioUrl,
      notes: req.body.notes,
      dynamicFields: parsedFields,
      resumeUrl: req.file ? (req.file.location || req.file.path) : null, // S3 URL or local path
    });

    await candidate.save();
    // Activity Log
    logActivity(
      req.body.createdBy,
      "created",
      "candidate",
      `Created candidate`,
      candidate._id,
      "CandidateByJob"
    );

    if (req.body.jobId) {
      await Job.findByIdAndUpdate(
        req.body.jobId,
        { $inc: { candidateCount: 1 } },
        { new: true }
      );
    }

    // 4️⃣ Send Email Notification to Mentor
    const candidateName = parsedFields.candidateName || parsedFields.CandidateName || "New Candidate";
    const jobTitle = job.title;
    // We don't await this to avoid blocking the response
    sendCreateNotificationToMentor(req.body.createdBy, candidateName, jobTitle);

    const candidateObj = candidate.toObject();
    const candidateWithSignedUrl = {
      ...candidateObj,
      resumeUrl: getSignedUrl(candidateObj.resumeUrl),
      offerLetter: getSignedUrl(candidateObj.offerLetter)
    };

    res.json({ success: true, candidate: candidateWithSignedUrl });

  } catch (error) {
    console.error("Error creating candidate:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create candidate",
    });
  }
});

// 🟣 Get Candidates with Role-Based Access Control (Pagination & Filtering)
router.get("/role-based-candidates", async (req, res) => {
  try {
    const { userId, designation, page, limit, search, status, client, jobTitle, stage, startDate, endDate, joinStartDate, joinEndDate, selectStartDate, selectEndDate, reporterId, jobStatus } = req.query;

    console.log("🔍 Role-Based Candidates Request:", {
      userId, designation, page, limit, startDate, endDate, joinStartDate, joinEndDate, selectStartDate, selectEndDate, reporterId, jobStatus
    });
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // 1️⃣ Determine Allowed User IDs (Creator Logic)
    const lowerDesignation = designation ? designation.toLowerCase() : "";
    let allowedUserIds = [];
    if (lowerDesignation === "admin") {
      allowedUserIds = null; // null means 'all'
    } else if (lowerDesignation === "recruiter") {
      allowedUserIds = [userId];
    } else if (lowerDesignation === "mentor" || lowerDesignation === "manager") {
      const allUsers = await User.find({}).select("_id reporter designation");
      const userIdStr = userId.toString();

      // Get direct reportees (designation-agnostic)
      const directReporteeIds = allUsers
        .filter(u => u.reporter && u.reporter.toString() === userIdStr)
        .map(u => u._id.toString());

      if (lowerDesignation === "manager") {
        // Get indirect reportees (e.g., Recruiters reporting to Mentors who report to this Manager)
        const indirectReporteeIds = allUsers
          .filter(u => u.reporter && directReporteeIds.includes(u.reporter.toString()))
          .map(u => u._id.toString());

        // Full team: Self + Direct reportees + Indirect reportees
        allowedUserIds = [...new Set([userIdStr, ...directReporteeIds, ...indirectReporteeIds])];
      } else {
        // Mentor: Self + Direct reportees (Recruiters)
        allowedUserIds = [userIdStr, ...directReporteeIds];
      }
    }

    // 2️⃣ Construct Match Query
    const matchStage = {};

    // A. Visibility Filter (Admin sees all, others strictly by creator or assigned job)
    if (lowerDesignation !== "admin") {
      if (allowedUserIds && allowedUserIds.length > 0) {
        const creatorCondition = {
          createdBy: { $in: allowedUserIds.map(id => new mongoose.Types.ObjectId(id)) }
        };

        // For Mentors and Managers, also include candidates for jobs they are assigned to
        if (lowerDesignation === "mentor" || lowerDesignation === "manager") {
          const userIdStr = userId.toString();

          // Find jobs where the user or their reportees are assigned
          const assignedJobs = await Job.find({
            $or: [
              { assignedMentors: new mongoose.Types.ObjectId(userIdStr) },
              { assignedRecruiters: { $in: allowedUserIds.map(id => new mongoose.Types.ObjectId(id)) } },
              { assignedRecruiter: { $in: allowedUserIds.map(id => new mongoose.Types.ObjectId(id)) } }
            ]
          }).select('_id');

          const assignedJobIds = assignedJobs.map(j => j._id);

          matchStage.$or = [
            creatorCondition,
            { jobId: { $in: assignedJobIds } }
          ];
        } else {
          matchStage.createdBy = creatorCondition.createdBy;
        }
      } else if (allowedUserIds && allowedUserIds.length === 0) {
        // Safety: If somehow no users found, restrict to self
        matchStage.createdBy = new mongoose.Types.ObjectId(userId);
      }
    }

    // B. Filters (Status, Stage, Search)
    if (status && status !== "all") {
      matchStage.status = new RegExp(`^${status}$`, "i");
    }
    if (stage && stage !== "all" && stage !== "All Stages") {
      matchStage.interviewStage = stage;
    }

    // Search logic remains in matchStage for query optimization


    // Search
    if (search) {
      const searchRegex = new RegExp(search, "i");
      const searchConditions = [
        { "dynamicFields.candidateName": searchRegex },
        { "dynamicFields.CandidateName": searchRegex },
        { "dynamicFields.Email": searchRegex },
        { "dynamicFields.email": searchRegex },
        { "dynamicFields.Phone": searchRegex },
        { "dynamicFields.phone": searchRegex },
        { "dynamicFields.Skills": searchRegex },
        { "dynamicFields.skills": searchRegex }
      ];

      if (matchStage.$or) {
        // If we already have $or for visibility, we need using $and
        matchStage.$and = [
          { $or: matchStage.$or },
          { $or: searchConditions }
        ];
        delete matchStage.$or;
      } else {
        matchStage.$or = searchConditions;
      }
    }

    // Pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Aggregation Pipeline
    const pipeline = [
      // 1. Initial Match (Visibility, Status, Stage, Search on Dynamic Fields)
      { $match: matchStage },

      // 1b. Context-aware date filtering
      ...(startDate || endDate ? [
        ...(!status || status === "all" ? [
          // Status = "all" → filter directly by createdAt
          {
            $match: {
              createdAt: {
                ...(startDate ? { $gte: new Date(startDate) } : {}),
                ...(endDate ? { $lte: (() => { const d = new Date(endDate); d.setHours(23, 59, 59, 999); return d; })() } : {})
              }
            }
          }
        ] : [
          // Specific status selected → compute relevantTimestamp from statusHistory
          {
            $addFields: {
              relevantTimestamp: {
                $switch: {
                  branches: [
                    {
                      case: {
                        $and: [
                          { $eq: [status, "Selected"] },
                          { $ne: ["$selectionDate", null] }
                        ]
                      },
                      then: "$selectionDate"
                    },
                    {
                      case: {
                        $and: [
                          { $eq: [status, "Joined"] },
                          { $ne: ["$joiningDate", null] }
                        ]
                      },
                      then: "$joiningDate"
                    }
                  ],
                  default: {
                    $let: {
                      vars: {
                        historyMatch: {
                          $arrayElemAt: [
                            {
                              $filter: {
                                input: { $ifNull: ["$statusHistory", []] },
                                as: "h",
                                cond: (["Shortlisted", "Screen", "Screened"].includes(status))
                                  ? { $in: ["$$h.status", ["Shortlisted", "Screen", "Screened"]] }
                                  : { $eq: ["$$h.status", status] }
                              }
                            },
                            -1
                          ]
                        }
                      },
                      in: {
                        $cond: [
                          { $not: ["$$historyMatch"] },
                          "$createdAt",
                          "$$historyMatch.timestamp"
                        ]
                      }
                    }
                  }
                }
              }
            }
          },
          {
            $match: {
              relevantTimestamp: {
                ...(startDate ? { $gte: new Date(startDate) } : {}),
                ...(endDate ? { $lte: (() => { const d = new Date(endDate); d.setHours(23, 59, 59, 999); return d; })() } : {})
              }
            }
          }
        ])
      ] : []),

      // 1d. Filter by Joined/Selected specific ranges if provided
      ...(joinStartDate || joinEndDate ? [{
        $match: {
          joiningDate: {
            ...(joinStartDate ? { $gte: new Date(joinStartDate) } : {}),
            ...(joinEndDate ? { $lte: (() => { const d = new Date(joinEndDate); d.setHours(23, 59, 59, 999); return d; })() } : {})
          }
        }
      }] : []),
      ...(selectStartDate || selectEndDate ? [{
        $match: {
          selectionDate: {
            ...(selectStartDate ? { $gte: new Date(selectStartDate) } : {}),
            ...(selectEndDate ? { $lte: (() => { const d = new Date(selectEndDate); d.setHours(23, 59, 59, 999); return d; })() } : {})
          }
        }
      }] : []),

      { $sort: { createdAt: -1 } },

      // 2. Lookups (Required for filtering by Client/JobTitle/Reporter/JobStatus)
      {
        $lookup: {
          from: "jobs",
          localField: "jobId",
          foreignField: "_id",
          as: "job"
        }
      },
      { $unwind: { path: "$job", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "clients",
          localField: "job.clientId",
          foreignField: "_id",
          as: "client"
        }
      },
      { $unwind: { path: "$client", preserveNullAndEmptyArrays: true } },

      // Lookup CreatedBy User
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "creator"
        }
      },
      { $unwind: { path: "$creator", preserveNullAndEmptyArrays: true } },

      // Lookup Creator's Reporter
      {
        $lookup: {
          from: "users",
          localField: "creator.reporter",
          foreignField: "_id",
          as: "reporter"
        }
      },
      { $unwind: { path: "$reporter", preserveNullAndEmptyArrays: true } },

      // 3. Secondary Match (Relational Filters)
      {
        $match: {
          ...(client && client !== "all" ? { "client.companyName": new RegExp(client, "i") } : {}),
          ...(jobTitle && jobTitle !== "all" ? { "job.title": new RegExp(jobTitle, "i") } : {}),
          ...(reporterId && reporterId !== "all" ? { "reporter._id": new mongoose.Types.ObjectId(reporterId) } : {}),
          ...(jobStatus && jobStatus !== "all" ? { "job.status": jobStatus } : {})
        }
      },

      // 4. Facet for Pagination
      {
        $facet: {
          candidates: [
            { $skip: skip },
            { $limit: limitNum },

            // Re-Populate/Format fields into expected structure
            {
              $project: {
                _id: 1,
                status: 1,
                interviewStage: 1,
                joiningDate: 1,
                offerLetter: 1,
                selectionDate: 1,
                expectedJoiningDate: 1,
                createdAt: 1,
                resumeUrl: 1,
                linkedinUrl: 1,
                portfolioUrl: 1,
                notes: 1,
                dynamicFields: 1,
                comments: 1,
                rejectionReason: 1,
                rejectedBy: 1,
                droppedBy: 1,
                interviewStageHistory: 1,
                statusHistory: 1,
                jobId: {
                  _id: "$job._id",
                  title: "$job.title",
                  status: "$job.status",
                  stages: "$job.stages",
                  clientId: {
                    _id: "$client._id",
                    companyName: "$client.companyName"
                  }
                },
                createdBy: {
                  _id: "$creator._id",
                  name: "$creator.name",
                  email: "$creator.email",
                  designation: "$creator.designation",
                  reporter: {
                    _id: "$reporter._id",
                    name: "$reporter.name"
                  }
                }
              }
            }
          ],
          totalCount: [{ $count: "count" }]
        }
      }
    ];

    const result = await Candidate.aggregate(pipeline);
    const candidates = result[0].candidates;
    const totalCandidates = result[0].totalCount[0] ? result[0].totalCount[0].count : 0;

    // Client and Job Title Filtering (Post-fetch or Pre-fetch?)
    // Note: To filter by client name or job title EFFICIENTLY, we should do lookups BEFORE match.
    // However, that's heavy. The frontend request implies these are primary filters.
    // Ideally, we should add lookups to the pipeline BEFORE the $facet if client/jobTitle filters are present.
    // For now, let's keep it simple. If client/JobTitle are needed, we can add them to matchStage if we know the IDs,
    // or add lookups before match.
    // Given the current structure, let's optimize:

    // RE-EVALUATION: The user wants to filter by Client Name and Job Title. 
    // Doing it after limit is WRONG for pagination. 
    // We must Lookup -> Match -> Skip/Limit.

    // ... (Refined Pipeline Logic below if filters exist) ...

    const candidatesWithSignedUrls = candidates.map(candidate => {
      // If using aggregate, it's already a plain object. If find, use .toObject() or .lean()
      // Since pipeline returns plain objects, we can map directly
      return {
        ...candidate,
        resumeUrl: getSignedUrl(candidate.resumeUrl),
        offerLetter: getSignedUrl(candidate.offerLetter)
      };
    });

    return res.json({
      success: true,
      candidates: candidatesWithSignedUrls,
      totalCandidates,
      totalPages: Math.ceil(totalCandidates / limitNum),
      currentPage: pageNum
    });

  } catch (err) {
    console.error("Error in GET /role-based-candidates:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});



// GET /api/CandidatesJob/user/:userId
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { page, limit, search, status, startDate, endDate, joinStartDate, joinEndDate, selectStartDate, selectEndDate } = req.query;

    console.log("🔍 Candidates User Request:", {
      userId, page, limit, search, status, startDate, endDate, joinStartDate, joinEndDate, selectStartDate, selectEndDate
    });

    // 1️⃣ Base Query: Candidates created by this user
    const query = { createdBy: userId };

    // 2️⃣ Filter by Status
    if (status && status !== "all" && status !== "All Status") {
      query.status = new RegExp(`^${status}$`, "i");
    }

    // 3️⃣ Search Filter
    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [
        { "dynamicFields.candidateName": searchRegex },
        { "dynamicFields.CandidateName": searchRegex },
        { "dynamicFields.Email": searchRegex },
        { "dynamicFields.email": searchRegex },
        { "dynamicFields.Phone": searchRegex },
        { "dynamicFields.phone": searchRegex },
        { "dynamicFields.Skills": searchRegex },
        { "dynamicFields.skills": searchRegex }
      ];
    }

    // A. Backward Compatibility / Non-Paginated Fetch
    if (!page || !limit) {
      const candidates = await Candidate.find(query)
        .populate({
          path: "jobId",
          select: "title _id clientId status stages",
          populate: {
            path: "clientId",
            select: "companyName"
          }
        })
        .populate("createdBy", "name email reporter designation")
        .sort({ createdAt: -1 });

      const candidatesWithSignedUrls = candidates.map(candidate => {
        const candidateObj = candidate.toObject();
        return {
          ...candidateObj,
          resumeUrl: getSignedUrl(candidateObj.resumeUrl),
          offerLetter: getSignedUrl(candidateObj.offerLetter)
        };
      });

      return res.json({ success: true, candidates: candidatesWithSignedUrls });
    }

    // B. Paginated Logic (Aggregation)
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Define the date match based on status history logic
    const pipeline = [
      { $match: { createdBy: new mongoose.Types.ObjectId(userId) } },

      // Calculate relevantTimestamp
      {
        $addFields: {
          relevantTimestamp: {
            $let: {
              vars: {
                historyMatch: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: { $ifNull: ["$statusHistory", []] },
                        as: "h",
                        cond: {
                          $cond: [
                            { $or: [{ $not: [status] }, { $eq: [status, "all"] }] },
                            { $eq: ["$$h.status", "$status"] },
                            {
                              $cond: [
                                { $in: [status, ["Shortlisted", "Screen", "Screened"]] },
                                { $in: ["$$h.status", ["Shortlisted", "Screen", "Screened"]] },
                                { $eq: ["$$h.status", status] }
                              ]
                            }
                          ]
                        }
                      }
                    },
                    -1
                  ]
                }
              },
              in: {
                $cond: [
                  { $not: ["$$historyMatch"] },
                  {
                    $switch: {
                      branches: [
                        { case: { $eq: ["$status", "Joined"] }, then: "$joiningDate" },
                        { case: { $eq: ["$status", "Selected"] }, then: "$selectionDate" }
                      ],
                      default: "$createdAt"
                    }
                  },
                  "$$historyMatch.timestamp"
                ]
              }
            }
          }
        }
      },

      // Filter by relevantTimestamp
      ...(startDate || endDate ? [{
        $match: {
          relevantTimestamp: {
            ...(startDate ? { $gte: new Date(startDate) } : {}),
            ...(endDate ? { $lte: (() => { const d = new Date(endDate); d.setHours(23, 59, 59, 999); return d; })() } : {})
          }
        }
      }] : []),

      // Filter by Joined/Selected specific ranges if provided
      ...(joinStartDate || joinEndDate ? [{
        $match: {
          joiningDate: {
            ...(joinStartDate ? { $gte: new Date(joinStartDate) } : {}),
            ...(joinEndDate ? { $lte: (() => { const d = new Date(joinEndDate); d.setHours(23, 59, 59, 999); return d; })() } : {})
          }
        }
      }] : []),
      ...(selectStartDate || selectEndDate ? [{
        $match: {
          selectionDate: {
            ...(selectStartDate ? { $gte: new Date(selectStartDate) } : {}),
            ...(selectEndDate ? { $lte: (() => { const d = new Date(selectEndDate); d.setHours(23, 59, 59, 999); return d; })() } : {})
          }
        }
      }] : []),

      // Status and Search (Remaining query logic)
      {
        $match: (() => {
          const { createdBy, ...rest } = query;
          return rest;
        })()
      },

      { $sort: { createdAt: -1 } },

      {
        $facet: {
          candidates: [
            { $skip: skip },
            { $limit: limitNum },
            {
              $lookup: {
                from: "users",
                localField: "createdBy",
                foreignField: "_id",
                as: "createdBy"
              }
            },
            { $unwind: "$createdBy" },
            {
              $lookup: {
                from: "jobs",
                localField: "jobId",
                foreignField: "_id",
                as: "jobId"
              }
            },
            { $unwind: "$jobId" },
            {
              $lookup: {
                from: "clients",
                localField: "jobId.clientId",
                foreignField: "_id",
                as: "jobId.clientId"
              }
            },
            { $unwind: "$jobId.clientId" }
          ],
          totalCount: [{ $count: "count" }]
        }
      }
    ];

    const result = await Candidate.aggregate(pipeline);
    const paginatedCandidates = result[0].candidates.map(candidate => ({
      ...candidate,
      resumeUrl: getSignedUrl(candidate.resumeUrl),
      offerLetter: getSignedUrl(candidate.offerLetter)
    }));
    const totalCandidates = result[0].totalCount[0] ? result[0].totalCount[0].count : 0;

    return res.json({
      success: true,
      candidates: paginatedCandidates,
      totalCandidates,
      totalPages: Math.ceil(totalCandidates / limitNum),
      currentPage: pageNum
    });

  } catch (err) {
    console.error("Error in GET /user/:userId:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 🟣 Get candidates by jobId
router.get("/job/:jobId", async (req, res) => {
  try {
    const candidates = await Candidate.find({ jobId: req.params.jobId })
      .populate("createdBy", "name email")
      .populate({
        path: "jobId",
        select: "title _id clientId stages", // Added stages
        populate: {
          path: "clientId",
          select: "companyName pocs"
        }
      })
      .populate({
        path: "interviewStageHistory.updatedBy",
        select: "name email designation",
      })
      .populate({
        path: "statusHistory.updatedBy",
        select: "name email designation",
      })
      .populate({
        path: "comments.author",
        select: "name email designation",
      })
      .sort({ createdAt: -1 });
    res.json({ success: true, candidates });
  } catch (error) {
    console.error("Error fetching candidates by job:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch candidates by job" });
  }
});

// 🟡 Update candidate details
router.put("/:id", upload.single("resume"), async (req, res) => {
  try {
    const { id } = req.params;
    const parsedFields = req.body.dynamicFields
      ? JSON.parse(req.body.dynamicFields)
      : {};

    // 1️⃣ Check if candidate exists and populate jobId for email
    const existingCandidate = await Candidate.findById(id).populate('jobId', 'title');
    if (!existingCandidate) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found",
      });
    }

    const { jobId } = req.body;

    // 2️⃣ Check for duplicate candidate (same email or phone for this job, excluding current candidate)
    const email = parsedFields.Email || parsedFields.email;
    const phone = parsedFields.Phone || parsedFields.phone;

    if (email || phone) {
      const duplicateQuery = {
        jobId: jobId,
        _id: { $ne: id }, // Exclude the current candidate
        $or: [],
      };

      if (email) {
        duplicateQuery.$or.push({
          $or: [
            { "dynamicFields.Email": email },
            { "dynamicFields.email": email },
          ],
        });
      }

      if (phone) {
        duplicateQuery.$or.push({
          $or: [
            { "dynamicFields.Phone": phone },
            { "dynamicFields.phone": phone },
          ],
        });
      }

      const duplicateCandidate = await Candidate.findOne(duplicateQuery);

      if (duplicateCandidate) {
        const duplicateField = [];
        if (email && (duplicateCandidate.dynamicFields?.Email === email || duplicateCandidate.dynamicFields?.email === email)) {
          duplicateField.push("email");
        }
        if (phone && (duplicateCandidate.dynamicFields?.Phone === phone || duplicateCandidate.dynamicFields?.phone === phone)) {
          duplicateField.push("phone");
        }

        return res.status(400).json({
          success: false,
          message: `Another candidate with the same ${duplicateField.join(" and ")} already exists for this job.`,
          duplicateCandidate: {
            name: duplicateCandidate.dynamicFields?.candidateName || duplicateCandidate.dynamicFields?.CandidateName,
            email: duplicateCandidate.dynamicFields?.Email || duplicateCandidate.dynamicFields?.email,
            phone: duplicateCandidate.dynamicFields?.Phone || duplicateCandidate.dynamicFields?.phone,
          },
        });
      }
    }

    // 3️⃣ Detect changes for email notification
    const changes = [];

    // Check dynamic fields changes
    const oldFields = existingCandidate.dynamicFields || {};
    for (const [key, newValue] of Object.entries(parsedFields)) {
      const oldValue = oldFields[key];
      if (oldValue !== newValue) {
        changes.push({
          field: key,
          oldValue: oldValue,
          newValue: newValue
        });
      }
    }

    // Check other fields
    if (req.body.linkedinUrl !== existingCandidate.linkedinUrl) {
      changes.push({
        field: 'LinkedIn URL',
        oldValue: existingCandidate.linkedinUrl,
        newValue: req.body.linkedinUrl
      });
    }

    if (req.body.portfolioUrl !== existingCandidate.portfolioUrl) {
      changes.push({
        field: 'Portfolio URL',
        oldValue: existingCandidate.portfolioUrl,
        newValue: req.body.portfolioUrl
      });
    }

    if (req.body.notes !== existingCandidate.notes) {
      changes.push({
        field: 'Notes',
        oldValue: existingCandidate.notes,
        newValue: req.body.notes
      });
    }

    if (req.file) {
      changes.push({
        field: 'Resume',
        oldValue: existingCandidate.resumeUrl ? 'Previous resume' : 'No resume',
        newValue: 'New resume uploaded'
      });

      // Delete old resume file (S3 or local)
      await deleteFile(existingCandidate.resumeUrl);
    }

    // 4️⃣ Update the candidate if no duplicates found
    const updateData = {
      jobId: req.body.jobId,
      createdBy: req.body.createdBy,
      linkedinUrl: req.body.linkedinUrl,
      portfolioUrl: req.body.portfolioUrl,
      notes: req.body.notes,
      dynamicFields: parsedFields,
      resumeUrl: req.file ? (req.file.location || req.file.path) : existingCandidate.resumeUrl,
    };

    const updatedCandidate = await Candidate.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate('jobId', 'title');

    // Activity Log
    logActivity(
      req.body.createdBy,
      "updated",
      "candidate",
      `Updated candidate details`,
      id,
      "CandidateByJob"
    );

    // 5️⃣ Send email notification if there are changes
    if (changes.length > 0) {
      const candidateName = parsedFields.candidateName || parsedFields.CandidateName || 'Unknown Candidate';
      const jobTitle = updatedCandidate.jobId?.title || 'Unknown Position';

      // Send email notification (async, don't wait for it)
      sendUpdateNotificationToReporter(req.body.createdBy, candidateName, jobTitle, changes)
        .catch(err => console.error('Email notification failed:', err));
    }

    res.json({ success: true, candidate: updatedCandidate });
  } catch (error) {
    console.error("Error updating candidate:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update candidate",
    });
  }
});

// ... existing update route ...

// 🔁 Update candidate status only
router.patch("/:id/status", offerLetterUpload.single("offerLetter"), async (req, res) => {
  try {
    const { status, role, interviewStage, stageStatus, stageNotes, joiningDate, selectionDate, expectedJoiningDate, rejectedBy, droppedBy, rejectionReason, comment, stageNameForHistory } = req.body;

    // Get existing candidate to detect changes
    const existingCandidate = await Candidate.findById(req.params.id).populate('jobId', 'title');
    if (!existingCandidate) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found",
      });
    }

    // Debug logging
    console.log('📋 Status Update Request:', {
      status,
      role,
      interviewStage,
      stageStatus,
      stageNotes,
      stageNotes,
      rejectedBy,
      droppedBy,
      rejectionReason,
      comment,
      willAddToHistory: status === "Interviewed" && interviewStage && stageStatus
    });

    // Detect changes for email notification
    const changes = [];

    if (existingCandidate.status !== status) {
      changes.push({
        field: 'Status',
        oldValue: existingCandidate.status,
        newValue: status
      });
    }

    if (status === "Rejected" && rejectedBy) {
      changes.push({
        field: 'Rejected By',
        oldValue: existingCandidate.rejectedBy || 'Not set',
        newValue: rejectedBy
      });
    }

    if (status === "Rejected" && rejectionReason) {
      changes.push({
        field: 'Rejection Reason',
        oldValue: existingCandidate.rejectionReason || 'Not set',
        newValue: rejectionReason
      });
    }

    if (status === "Dropped" && droppedBy) {
      changes.push({
        field: 'Dropped By',
        oldValue: existingCandidate.droppedBy || 'Not set',
        newValue: droppedBy
      });
    }

    if (interviewStage && existingCandidate.interviewStage !== interviewStage) {
      changes.push({
        field: 'Interview Stage',
        oldValue: existingCandidate.interviewStage || 'Not set',
        newValue: interviewStage
      });
    }

    if (stageStatus) {
      changes.push({
        field: 'Stage Status',
        oldValue: 'N/A',
        newValue: stageStatus
      });
    }

    if (stageNotes) {
      changes.push({
        field: 'Stage Notes',
        oldValue: 'N/A',
        newValue: stageNotes
      });
    }

    if (comment) {
      changes.push({
        field: 'Remarks',
        oldValue: existingCandidate.notes || 'None',
        newValue: comment
      });
    }

    const updateData = { status, UpdatedStatusBy: role };

    if (comment) {
      updateData.notes = comment;
    }

    // Handle RejectedBy and File Deletion
    if (status === "Rejected") {
      if (rejectedBy) {
        updateData.rejectedBy = rejectedBy;
      }
      if (rejectionReason) {
        updateData.rejectionReason = rejectionReason;
      }

      // Delete files (resume, offer letter) if candidate is rejected
      if (existingCandidate.resumeUrl) {
        console.log('🗑️ Deleting candidate resume due to rejection');
        await deleteFile(existingCandidate.resumeUrl);
        updateData.resumeUrl = null;
      }
      if (existingCandidate.offerLetter) {
        console.log('🗑️ Deleting candidate offer letter due to rejection');
        await deleteFile(existingCandidate.offerLetter);
        updateData.offerLetter = null;
      }
    }

    // Handle DroppedBy
    if (status === "Dropped" && droppedBy) {
      updateData.droppedBy = droppedBy;
    }

    // If moving to an interview stage, update the current stage
    if (interviewStage !== undefined) {
      updateData.interviewStage = interviewStage;
    }

    // If status is "Joined" and joiningDate is provided, update it
    if (status === "Joined" && joiningDate) {
      updateData.joiningDate = joiningDate;
      // Add to changes for email notification
      changes.push({
        field: 'Joining Date',
        oldValue: existingCandidate.joiningDate ? new Date(existingCandidate.joiningDate).toLocaleDateString() : 'N/A',
        newValue: new Date(joiningDate).toLocaleDateString()
      });

      // Handle Offer Letter Upload
      if (req.file) {
        console.log('📄 Offer Letter File Uploaded:', {
          filename: req.file.filename,
          originalname: req.file.originalname,
          path: req.file.path,
          size: req.file.size
        });

        // Delete old offer letter file (S3 or local)
        await deleteFile(existingCandidate.offerLetter);


        updateData.offerLetter = req.file.location || req.file.path; // S3 URL or local path
        console.log('✅ Offer Letter URL Saved:', updateData.offerLetter);
        changes.push({
          field: 'Offer Letter',
          oldValue: existingCandidate.offerLetter ? 'Previous Offer Letter' : 'None',
          newValue: 'New Offer Letter Uploaded'
        });
      }
    }

    // If status is "Selected" and selectionDate is provided, update it
    if (status === "Selected" && selectionDate) {
      updateData.selectionDate = selectionDate;
      changes.push({
        field: 'Selection Date',
        oldValue: existingCandidate.selectionDate ? new Date(existingCandidate.selectionDate).toLocaleDateString() : 'N/A',
        newValue: new Date(selectionDate).toLocaleDateString()
      });

      // Handle Expected Joining Date (optional)
      if (expectedJoiningDate) {
        updateData.expectedJoiningDate = expectedJoiningDate;
        changes.push({
          field: 'Expected Joining Date',
          oldValue: existingCandidate.expectedJoiningDate ? new Date(existingCandidate.expectedJoiningDate).toLocaleDateString() : 'N/A',
          newValue: new Date(expectedJoiningDate).toLocaleDateString()
        });
      }
    }

    // Handle Offered CTC
    const { offeredCTC } = req.body;
    if (offeredCTC) {
      if (!updateData.dynamicFields) {
        updateData.dynamicFields = { ...existingCandidate.dynamicFields };
      }
      updateData.dynamicFields["Offered CTC"] = offeredCTC;
      changes.push({
        field: 'Offered CTC',
        oldValue: existingCandidate.dynamicFields?.["Offered CTC"] || 'Not set',
        newValue: offeredCTC
      });
    }

    // If stage status and notes are provided, add to history
    // [FIX] Allow adding to history even if final status is Rejected, as long as it was an interview update
    if ((status === "Interviewed" || status === "Rejected") && interviewStage && stageStatus) {
      const stageHistoryEntry = {
        stageName: stageNameForHistory || interviewStage,
        status: stageStatus,
        notes: stageNotes || "",
        updatedBy: role,
        timestamp: new Date(),
      };

      console.log('✅ Adding to interviewStageHistory:', stageHistoryEntry);

      updateData.$push = {
        interviewStageHistory: stageHistoryEntry,
      };
    }

    // Always add to statusHistory
    const statusHistoryEntry = {
      status,
      comment: req.body.comment || "",
      joiningDate: status === "Joined" ? joiningDate : undefined,
      rejectedBy: status === "Rejected" ? rejectedBy : undefined,
      rejectionReason: status === "Rejected" ? rejectionReason : undefined,
      droppedBy: status === "Dropped" ? droppedBy : undefined,
      updatedBy: role,
      timestamp: new Date(),
    };

    if (!updateData.$push) {
      updateData.$push = {};
    }
    updateData.$push.statusHistory = statusHistoryEntry;

    const updatedCandidate = await Candidate.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    )
      .populate("jobId", "title")
      .populate("statusHistory.updatedBy", "name email");

    // Activity Log
    // Activity Log
    logActivity(
      role,
      "updated",
      "candidate-status",
      `Updated candidate status to "${status}"${interviewStage ? ` (${interviewStage} - ${stageStatus || "N/A"})` : ""}${status === "Rejected" && rejectedBy ? ` (Rejected by: ${rejectedBy})` : ""}${status === "Dropped" && droppedBy ? ` (Dropped by: ${droppedBy})` : ""}`,
      req.params.id,
      "CandidateByJob"
    );

    // Send email notification if there are changes
    if (changes.length > 0) {
      const candidateName = existingCandidate.dynamicFields?.candidateName ||
        existingCandidate.dynamicFields?.CandidateName ||
        'Unknown Candidate';
      const jobTitle = updatedCandidate.jobId?.title || 'Unknown Position';

      // Send email notification (async, don't wait for it)
      sendUpdateNotificationToReporter(role, candidateName, jobTitle, changes)
        .catch(err => console.error('Email notification failed:', err));
    }

    const candidatePosObj = updatedCandidate.toObject();
    const candidateWithSignedUrl = {
      ...candidatePosObj,
      resumeUrl: getSignedUrl(candidatePosObj.resumeUrl),
      offerLetter: getSignedUrl(candidatePosObj.offerLetter)
    };

    res.json({ success: true, candidate: candidateWithSignedUrl });
  } catch (error) {
    console.error("Error updating candidate status:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to update status" });
  }
});

// 💬 Add standalone comment
router.post("/:id/comments", async (req, res) => {
  try {
    const { text, authorId } = req.body;

    if (!text) {
      return res.status(400).json({ success: false, message: "Comment text is required" });
    }

    const updatedCandidate = await Candidate.findByIdAndUpdate(
      req.params.id,
      {
        $push: {
          comments: {
            text,
            author: authorId,
            timestamp: new Date()
          }
        }
      },
      { new: true }
    ).populate("comments.author", "name email designation");

    if (!updatedCandidate) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }

    res.json({ success: true, candidate: updatedCandidate });
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ success: false, message: "Failed to add comment" });
  }
});

// ❌ Delete candidate
router.delete("/:id/:role", async (req, res) => {
  try {
    // 1. Find the candidate first
    const candidate = await Candidate.findById(req.params.id);

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found",
      });
    }

    const jobId = candidate.jobId; // store jobId before deletion


    // Delete associated files (resume and offer letter) - S3 or local
    await deleteFile(candidate.resumeUrl);
    await deleteFile(candidate.offerLetter);

    // 2. Delete the candidate
    await Candidate.findByIdAndDelete(req.params.id);
    // Activity Log
    logActivity(
      req.params.role,
      "deleted",
      "candidate",
      `Deleted candidate`,
      req.params.id,
      "CandidateByJob"
    );

    // 3. Decrease candidate count in the corresponding job
    if (jobId) {
      await Job.findByIdAndUpdate(
        jobId,
        { $inc: { candidateCount: -1 } },
        { new: true }
      );
    }

    res.json({
      success: true,
      message: "Candidate deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting candidate:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete candidate",
    });
  }
});

// 📧 Send Candidate Email (Supports Multiple)
router.post("/send-email", async (req, res) => {
  const { senderEmail, appPassword, recipientEmails, ccEmails, candidateIds } = req.body;

  if (!senderEmail || !appPassword || !recipientEmails || !candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
    return res.status(400).json({ success: false, message: "Missing required fields or invalid candidate IDs" });
  }

  try {
    const candidates = await Candidate.find({ _id: { $in: candidateIds } }).populate({
      path: "jobId",
      select: "title"
    });

    if (!candidates || candidates.length === 0) {
      return res.status(404).json({ success: false, message: "No candidates found" });
    }

    const nodemailer = require("nodemailer");

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: senderEmail,
        pass: appPassword,
      },
    });

    let htmlContent = "";
    let subject = "";

    if (candidates.length === 1) {
      const candidate = candidates[0];
      const dynamicFields = candidate.dynamicFields || {};
      subject = `Candidate Profile: ${dynamicFields.candidateName || "Candidate"} - ${candidate.jobId?.title}`;

      let tableRows = "";
      for (const [key, value] of Object.entries(dynamicFields)) {
        tableRows += `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">${key}</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${value || "N/A"}</td>
          </tr>
        `;
      }

      htmlContent = `
        <h3>Candidate Profile: ${dynamicFields.candidateName || "Candidate"}</h3>
        <p><strong>Position:</strong> ${candidate.jobId?.title || "N/A"}</p>
        <br/>
        <table style="border-collapse: collapse; width: 100%; max-width: 600px;">
          <thead>
            <tr style="background-color: #f2f2f2;">
              <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Field</th>
              <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Details</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
        <br/>
        <p>Regards,</p>
      `;
    } else {
      const jobTitle = candidates[0].jobId?.title || "the position";
      subject = `Candidate Profiles (${candidates.length}) - ${jobTitle}`;

      htmlContent = `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          <h2 style="color: #2c3e50;">Candidate Profiles Shared</h2>
          <p>Hello,</p>
          <p>We are pleased to share the profiles of the following candidates for the position of <strong>${jobTitle}</strong>.</p>
          <p>Please review the summary of candidates below:</p>
          <br/>
      `;

      // Collect all unique keys from dynamicFields
      const allKeys = new Set();
      candidates.forEach(c => {
        if (c.dynamicFields && typeof c.dynamicFields === 'object') {
          Object.keys(c.dynamicFields).forEach(k => {
            if (k && k.trim() !== '' && k.toLowerCase() !== 'undefined' && k.toLowerCase() !== 'null') {
              allKeys.add(k);
            }
          });
        }
      });

      // Prioritize 'candidateName' if it exists, otherwise just use the keys
      let headers = Array.from(allKeys);
      if (headers.includes('candidateName')) {
        headers = ['candidateName', ...headers.filter(h => h !== 'candidateName')];
      }

      // Build Table Header
      let headerHtml = '<tr style="background-color: #f8f9fa;">';
      // Add Position column
      headerHtml += '<th style="padding: 12px; border: 1px solid #dee2e6; text-align: left; color: #495057;">Position</th>';

      headers.forEach(key => {
        // Capitalize first letter for better display
        const displayKey = key.charAt(0).toUpperCase() + key.slice(1);
        headerHtml += `<th style="padding: 12px; border: 1px solid #dee2e6; text-align: left; color: #495057;">${displayKey}</th>`;
      });
      headerHtml += '</tr>';

      // Build Table Body
      let bodyHtml = '';
      candidates.forEach(candidate => {
        const dynamicFields = candidate.dynamicFields || {};
        bodyHtml += '<tr>';

        // Position Data
        bodyHtml += `<td style="padding: 10px; border: 1px solid #dee2e6;">${candidate.jobId?.title || "N/A"}</td>`;

        // Dynamic Fields Data
        headers.forEach(key => {
          bodyHtml += `<td style="padding: 10px; border: 1px solid #dee2e6;">${dynamicFields[key] || "N/A"}</td>`;
        });
        bodyHtml += '</tr>';
      });

      htmlContent += `
        <div style="overflow-x: auto;">
          <table style="border-collapse: collapse; width: 100%; border: 1px solid #dee2e6; font-size: 14px;">
            <thead>
              ${headerHtml}
            </thead>
            <tbody>
              ${bodyHtml}
            </tbody>
          </table>
        </div>
        <br/>
        <p>Please let us know your feedback or if you would like to proceed with any of these candidates.</p>
        <br/>
        <p>Best Regards,</p>
        <p><strong>Recruitment Team</strong></p>
        </div>
      `;
    }

    const path = require('path');
    const fs = require('fs');
    const attachments = [];

    candidates.forEach(candidate => {
      if (candidate.resumeUrl) {
        // Check if resumeUrl is a valid server path (not a blob or http url)
        if (candidate.resumeUrl.startsWith('blob:') || candidate.resumeUrl.startsWith('http')) {
          console.warn(`Skipping invalid resume URL for candidate ${candidate._id}: ${candidate.resumeUrl}`);
          return;
        }

        // resumeUrl is stored as /uploads/resumes/filename
        // We need to resolve it to the absolute path on the server
        // Assuming the server is running in Backend/ and uploads are in Backend/uploads
        const absolutePath = path.join(__dirname, '..', candidate.resumeUrl);

        if (fs.existsSync(absolutePath)) {
          // Extract filename for the attachment
          const filename = path.basename(absolutePath);

          attachments.push({
            filename: filename,
            path: absolutePath
          });
        } else {
          console.warn(`Resume file not found for candidate ${candidate._id}: ${absolutePath}`);
        }
      }
    });

    const mailOptions = {
      from: senderEmail,
      to: recipientEmails,
      cc: ccEmails,
      subject: subject,
      html: htmlContent,
      attachments: attachments
    };

    await transporter.sendMail(mailOptions);

    res.json({ success: true, message: "Email sent successfully" });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ success: false, message: "Failed to send email. Check credentials." });
  }
});

module.exports = router;
