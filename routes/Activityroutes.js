const express = require("express");
const ActivityLog = require("../models/activitylog");
const User = require("../models/Users");
const Candidate = require("../models/CandidatesByJob");
const router = express.Router();

const ACTION_OPTIONS = {
    candidate_created: "Candidate Created",
    candidate_updated: "Candidate Updated",
    candidate_deleted: "Candidate Deleted",
    candidate_viewed: "Candidate Viewed",
    resume: "Resume",
    resume_replaced: "Resume Replaced",
    status_changed: "Status Changed",
    assignment_changed: "Assignment Changed",
    interview: "Interview",
    screening: "Screening",
    client_submission: "Client Submission",
    client_feedback: "Client Feedback",
    offer: "Offer",
    joining: "Joining",
    email: "Email",
    comment: "Comment",
    other: "Other",
};

function escapeRegex(value = "") {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCandidateField(candidate, keys) {
    const fields = candidate?.dynamicFields || {};
    for (const key of keys) {
        if (fields[key] !== undefined && fields[key] !== null && fields[key] !== "") {
            return fields[key];
        }
    }
    return "";
}

function normalizeUser(user) {
    if (!user) return null;
    return {
        _id: user._id,
        name: user.name || "Unknown user",
        email: user.email || "",
        role: user.designation || "",
        designation: user.designation || "",
        profilePhoto: user.profilePhoto || "",
    };
}

function getReporter(user) {
    if (!user || !user.reporter || typeof user.reporter !== "object") return null;
    return user.reporter;
}

function getAssignmentFromCandidate(candidate) {
    const recruiter = candidate?.createdBy && typeof candidate.createdBy === "object"
        ? candidate.createdBy
        : null;
    const mentor = getReporter(recruiter);
    const manager = getReporter(mentor);

    return {
        recruiter: normalizeUser(recruiter),
        mentor: normalizeUser(mentor),
        manager: normalizeUser(manager),
    };
}

function formatCandidate(candidate) {
    const assignment = getAssignmentFromCandidate(candidate);
    return {
        _id: candidate._id,
        name: getCandidateField(candidate, ["candidateName", "CandidateName", "Name", "name"]) || "Unnamed Candidate",
        email: getCandidateField(candidate, ["Email", "email"]),
        phone: getCandidateField(candidate, ["Phone", "phone", "Mobile", "mobile"]),
        status: candidate.status,
        createdAt: candidate.createdAt,
        job: candidate.jobId ? {
            _id: candidate.jobId._id,
            title: candidate.jobId.title,
            department: candidate.jobId.department,
        } : null,
        client: candidate.jobId?.clientId ? {
            _id: candidate.jobId.clientId._id,
            name: candidate.jobId.clientId.name || candidate.jobId.clientId.clientName || "",
        } : null,
        ...assignment,
    };
}

function inferActionType(log) {
    const raw = `${log.actionType || ""} ${log.module || ""} ${log.action || ""} ${log.description || ""}`.toLowerCase();
    if (raw.includes("status")) return "status_changed";
    if (raw.includes("comment")) return "comment";
    if (raw.includes("interview")) return "interview";
    if (raw.includes("resume")) return "resume";
    if (raw.includes("email")) return "email";
    if (raw.includes("client")) return "client_submission";
    if (raw.includes("offer")) return "offer";
    if (raw.includes("join")) return "joining";
    if (raw.includes("deleted")) return "candidate_deleted";
    if (raw.includes("created")) return "candidate_created";
    if (raw.includes("updated")) return "candidate_updated";
    return "other";
}

function timelineUser(user, fallbackRole) {
    const normalized = normalizeUser(user);
    if (normalized) return normalized;
    return {
        _id: null,
        name: "Unknown user",
        email: "",
        role: fallbackRole || "",
        designation: fallbackRole || "",
        profilePhoto: "",
    };
}

function buildActivityFromLog(log, candidate) {
    const actionType = inferActionType(log);
    return {
        _id: `activity-${log._id}`,
        source: "activityLog",
        timestamp: log.createdAt,
        actionType,
        actionLabel: ACTION_OPTIONS[actionType] || ACTION_OPTIONS.other,
        title: log.description || ACTION_OPTIONS[actionType] || "Candidate activity",
        description: log.description || "",
        user: timelineUser(log.userId, log.performedByRole),
        previousValue: log.previousValue,
        newValue: log.newValue,
        metadata: log.metadata || {},
        statusAtPoint: log.metadata?.status || candidate.status,
        job: candidate.jobId ? {
            _id: candidate.jobId._id,
            title: candidate.jobId.title,
        } : null,
        client: candidate.jobId?.clientId ? {
            _id: candidate.jobId.clientId._id,
            name: candidate.jobId.clientId.name || candidate.jobId.clientId.clientName || "",
        } : null,
    };
}

function activityMatches(activity, filters) {
    if (filters.role && filters.role !== "All" && activity.user?.role !== filters.role) {
        return false;
    }

    if (filters.action && filters.action !== "all" && activity.actionType !== filters.action) {
        return false;
    }

    if (filters.userId && String(activity.user?._id) !== String(filters.userId)) {
        return false;
    }

    const timestamp = new Date(activity.timestamp);
    if (filters.startDate && timestamp < new Date(filters.startDate)) return false;
    if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        if (timestamp > end) return false;
    }

    if (filters.search) {
        const needle = filters.search.toLowerCase();
        const haystack = [
            activity.title,
            activity.description,
            activity.actionLabel,
            activity.user?.name,
            activity.user?.role,
            activity.previousValue,
            activity.newValue,
            activity.metadata?.comment,
            activity.metadata?.notes,
            activity.metadata?.text,
            activity.job?.title,
            activity.client?.name,
        ].map((value) => typeof value === "string" ? value : JSON.stringify(value || "")).join(" ").toLowerCase();

        if (!haystack.includes(needle)) return false;
    }

    return true;
}

async function getOrganizationTree() {
    const users = await User.find({
        designation: { $in: ["Admin", "Manager", "Mentor", "Recruiter"] },
    }).select("name email designation reporter profilePhoto").lean();

    const byId = new Map(users.map((user) => [String(user._id), {
        ...user,
        _id: user._id,
        children: [],
    }]));

    const managers = [];
    const unassignedMentors = [];
    const unassignedRecruiters = [];

    users.filter((user) => user.designation === "Manager").forEach((manager) => {
        managers.push(byId.get(String(manager._id)));
    });

    users.filter((user) => user.designation === "Mentor").forEach((mentor) => {
        const reporter = mentor.reporter ? byId.get(String(mentor.reporter)) : null;
        const mentorNode = byId.get(String(mentor._id));
        if (reporter && reporter.designation === "Manager") {
            reporter.children.push(mentorNode);
        } else {
            unassignedMentors.push(mentorNode);
        }
    });

    users.filter((user) => user.designation === "Recruiter").forEach((recruiter) => {
        const reporter = recruiter.reporter ? byId.get(String(recruiter.reporter)) : null;
        const recruiterNode = byId.get(String(recruiter._id));
        if (reporter && reporter.designation === "Mentor") {
            reporter.children.push(recruiterNode);
        } else {
            unassignedRecruiters.push(recruiterNode);
        }
    });

    return {
        managers,
        unassignedMentors,
        unassignedRecruiters,
        users: Array.from(byId.values()),
    };
}

router.get("/organization-tree", async (req, res) => {
    try {
        const organization = await getOrganizationTree();
        res.json({ success: true, organization });
    } catch (error) {
        console.error("Error fetching organization tree:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch organization tree",
        });
    }
});

router.get("/candidate-search", async (req, res) => {
    try {
        const {
            search = "",
            jobId,
            recruiterId,
            mentorId,
            managerId,
            startDate,
            endDate,
            actionType,
        } = req.query;
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);

        const query = {};

        if (jobId) query.jobId = jobId;
        if (recruiterId) query.createdBy = recruiterId;

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.createdAt.$lte = end;
            }
        }

        if (search) {
            const regex = new RegExp(escapeRegex(search), "i");
            query.$or = [
                { "dynamicFields.candidateName": regex },
                { "dynamicFields.CandidateName": regex },
                { "dynamicFields.Name": regex },
                { "dynamicFields.name": regex },
                { "dynamicFields.Email": regex },
                { "dynamicFields.email": regex },
                { "dynamicFields.Phone": regex },
                { "dynamicFields.phone": regex },
                { "dynamicFields.Mobile": regex },
                { "dynamicFields.mobile": regex },
            ];
        }

        if (actionType && actionType !== "all") {
            const matchingLogs = await ActivityLog.find({
                actionType,
                candidateId: { $exists: true, $ne: null },
            }).select("candidateId").lean();
            query._id = { $in: matchingLogs.map((log) => log.candidateId) };
        }

        let candidates = await Candidate.find(query)
            .populate({
                path: "createdBy",
                select: "name email designation reporter profilePhoto",
                populate: {
                    path: "reporter",
                    select: "name email designation reporter profilePhoto",
                    populate: {
                        path: "reporter",
                        select: "name email designation reporter profilePhoto",
                    },
                },
            })
            .populate({
                path: "jobId",
                select: "title department clientId",
                populate: {
                    path: "clientId",
                    select: "name clientName",
                },
            })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        if (mentorId || managerId) {
            candidates = candidates.filter((candidate) => {
                const assignment = getAssignmentFromCandidate(candidate);
                if (mentorId && String(assignment.mentor?._id) !== String(mentorId)) {
                    return false;
                }
                if (managerId && String(assignment.manager?._id) !== String(managerId)) {
                    return false;
                }
                return true;
            });
        }

        res.json({
            success: true,
            candidates: candidates.map(formatCandidate),
        });
    } catch (error) {
        console.error("Error searching candidate timeline data:", error);
        res.status(500).json({
            success: false,
            message: "Failed to search candidates",
        });
    }
});

router.get("/candidate/:candidateId/timeline", async (req, res) => {
    try {
        const { candidateId } = req.params;
        const {
            role = "All",
            action = "all",
            startDate,
            endDate,
            search = "",
            sort = "desc",
            userId,
        } = req.query;

        const candidate = await Candidate.findById(candidateId)
            .populate({
                path: "createdBy",
                select: "name email designation reporter profilePhoto",
                populate: {
                    path: "reporter",
                    select: "name email designation reporter profilePhoto",
                    populate: {
                        path: "reporter",
                        select: "name email designation reporter profilePhoto",
                    },
                },
            })
            .populate({
                path: "jobId",
                select: "title department clientId",
                populate: {
                    path: "clientId",
                    select: "name clientName",
                },
            })
            .populate("statusHistory.updatedBy", "name email designation profilePhoto")
            .populate("interviewStageHistory.updatedBy", "name email designation profilePhoto")
            .populate("comments.author", "name email designation profilePhoto")
            .lean();

        if (!candidate) {
            return res.status(404).json({
                success: false,
                message: "Candidate not found",
            });
        }

        const logs = await ActivityLog.find({
            $or: [
                { candidateId },
                { targetId: candidateId, targetModel: "CandidateByJob" },
            ],
        })
            .populate("userId", "name email designation profilePhoto")
            .sort({ createdAt: -1 })
            .lean();

        const activities = logs.map((log) => buildActivityFromLog(log, candidate));

        const hasCreatedLog = activities.some((activity) => activity.actionType === "candidate_created");
        if (!hasCreatedLog && candidate.createdAt && candidate.createdBy) {
            activities.push({
                _id: `candidate-created-${candidate._id}`,
                source: "candidate",
                timestamp: candidate.createdAt,
                actionType: "candidate_created",
                actionLabel: ACTION_OPTIONS.candidate_created,
                title: "Candidate record created",
                description: "Candidate record created",
                user: timelineUser(candidate.createdBy),
                previousValue: null,
                newValue: candidate.status,
                metadata: {
                    status: candidate.status,
                    source: "candidate_record",
                },
                statusAtPoint: candidate.status,
                job: candidate.jobId ? { _id: candidate.jobId._id, title: candidate.jobId.title } : null,
                client: candidate.jobId?.clientId ? {
                    _id: candidate.jobId.clientId._id,
                    name: candidate.jobId.clientId.name || candidate.jobId.clientId.clientName || "",
                } : null,
            });
        }

        (candidate.statusHistory || []).forEach((entry, index, history) => {
            const previous = index > 0 ? history[index - 1].status : undefined;
            activities.push({
                _id: `status-${entry._id || index}`,
                source: "statusHistory",
                timestamp: entry.timestamp,
                actionType: "status_changed",
                actionLabel: ACTION_OPTIONS.status_changed,
                title: "Candidate status changed",
                description: entry.comment || `Candidate status changed to ${entry.status}`,
                user: timelineUser(entry.updatedBy),
                previousValue: previous,
                newValue: entry.status,
                metadata: {
                    comment: entry.comment,
                    joiningDate: entry.joiningDate,
                    rejectionReason: entry.rejectionReason,
                    status: entry.status,
                },
                statusAtPoint: entry.status,
                job: candidate.jobId ? { _id: candidate.jobId._id, title: candidate.jobId.title } : null,
                client: candidate.jobId?.clientId ? {
                    _id: candidate.jobId.clientId._id,
                    name: candidate.jobId.clientId.name || candidate.jobId.clientId.clientName || "",
                } : null,
            });
        });

        (candidate.interviewStageHistory || []).forEach((entry, index) => {
            activities.push({
                _id: `interview-${entry._id || index}`,
                source: "interviewStageHistory",
                timestamp: entry.timestamp,
                actionType: "interview",
                actionLabel: ACTION_OPTIONS.interview,
                title: "Interview feedback added",
                description: entry.notes || `${entry.stageName} marked ${entry.status}`,
                user: timelineUser(entry.updatedBy),
                previousValue: entry.stageName,
                newValue: entry.status,
                metadata: {
                    stageName: entry.stageName,
                    result: entry.status,
                    notes: entry.notes,
                    status: candidate.status,
                },
                statusAtPoint: candidate.status,
                job: candidate.jobId ? { _id: candidate.jobId._id, title: candidate.jobId.title } : null,
                client: candidate.jobId?.clientId ? {
                    _id: candidate.jobId.clientId._id,
                    name: candidate.jobId.clientId.name || candidate.jobId.clientId.clientName || "",
                } : null,
            });
        });

        (candidate.comments || []).forEach((entry, index) => {
            activities.push({
                _id: `comment-${entry._id || index}`,
                source: "comment",
                timestamp: entry.timestamp,
                actionType: "comment",
                actionLabel: ACTION_OPTIONS.comment,
                title: "Comment added",
                description: entry.text,
                user: timelineUser(entry.author),
                previousValue: null,
                newValue: entry.text,
                metadata: {
                    text: entry.text,
                    status: candidate.status,
                },
                statusAtPoint: candidate.status,
                job: candidate.jobId ? { _id: candidate.jobId._id, title: candidate.jobId.title } : null,
                client: candidate.jobId?.clientId ? {
                    _id: candidate.jobId.clientId._id,
                    name: candidate.jobId.clientId.name || candidate.jobId.clientId.clientName || "",
                } : null,
            });
        });

        const filters = { role, action, startDate, endDate, search, userId };
        const filteredActivities = activities
            .filter((activity) => activityMatches(activity, filters))
            .sort((a, b) => {
                const diff = new Date(a.timestamp) - new Date(b.timestamp);
                return sort === "asc" ? diff : -diff;
            });

        res.json({
            success: true,
            candidate: formatCandidate(candidate),
            activities: filteredActivities,
            actionOptions: ACTION_OPTIONS,
        });
    } catch (error) {
        console.error("Error fetching candidate timeline:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch candidate timeline",
        });
    }
});

/**
 * Recursively get all team members under a user based on role hierarchy
 * - Recruiter: only themselves
 * - Mentor: themselves + direct recruiters
 * - Manager: themselves + mentors + all recruiters under those mentors
 * - Admin: everyone
 */
async function getTeamMemberIds(userId, userDesignation) {
    try {
        const teamIds = [userId];

        if (userDesignation === "Admin") {
            // Admin sees all users
            const allUsers = await User.find().select("_id");
            return allUsers.map((u) => u._id.toString());
        }

        if (userDesignation === "Manager") {
            // Manager sees: themselves + mentors reporting to them + recruiters under those mentors
            const mentors = await User.find({
                reporter: userId,
                designation: "Mentor"
            }).select("_id");

            const mentorIds = mentors.map((m) => m._id);
            teamIds.push(...mentorIds.map(id => id.toString()));

            // Get all recruiters under these mentors
            for (const mentorId of mentorIds) {
                const recruiters = await User.find({
                    reporter: mentorId,
                    designation: "Recruiter"
                }).select("_id");
                teamIds.push(...recruiters.map((r) => r._id.toString()));
            }
        } else if (userDesignation === "Mentor") {
            // Mentor sees: themselves + recruiters reporting to them
            const recruiters = await User.find({
                reporter: userId,
                designation: "Recruiter"
            }).select("_id");
            teamIds.push(...recruiters.map((r) => r._id.toString()));
        }
        // Recruiter only sees themselves (already in teamIds)

        return teamIds;
    } catch (error) {
        console.error("Error getting team member IDs:", error);
        return [userId];
    }
}

// Get recent activity logs for a user based on their role hierarchy
router.get("/user/:userId", async (req, res) => {
    try {
        const userId = req.params.userId;
        const limit = parseInt(req.query.limit) || 3; // Default to 3-4 recent activities per person

        // Get the user to check their designation
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        // Get all team member IDs based on role hierarchy
        const teamMemberIds = await getTeamMemberIds(userId, user.designation);

        // Get recent activities for each team member (limit per person)
        const mongoose = require('mongoose');
        const activities = await ActivityLog.aggregate([
            {
                $match: {
                    userId: { $in: teamMemberIds.map(id => new mongoose.Types.ObjectId(id)) }
                }
            },
            {
                $sort: { createdAt: -1 }
            },
            {
                $group: {
                    _id: "$userId",
                    activities: { $push: "$$ROOT" }
                }
            },
            {
                $project: {
                    activities: { $slice: ["$activities", limit] }
                }
            },
            {
                $unwind: "$activities"
            },
            {
                $replaceRoot: { newRoot: "$activities" }
            },
            {
                $sort: { createdAt: -1 }
            },
            {
                $limit: 50 // Overall limit
            }
        ]);

        // Populate the activities
        await ActivityLog.populate(activities, [
            {
                path: "userId",
                select: "name email designation"
            },
            {
                path: "targetId",
                select: "title dynamicFields status"
            }
        ]);

        res.json({ success: true, activities });
    } catch (error) {
        console.error("Error fetching activity logs:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch activity logs",
            error: error.message
        });
    }
});

// Get recent activity logs for the entire organization (for admins)
router.get("/all", async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 3;

        const activities = await ActivityLog.aggregate([
            {
                $sort: { createdAt: -1 }
            },
            {
                $group: {
                    _id: "$userId",
                    activities: { $push: "$$ROOT" }
                }
            },
            {
                $project: {
                    activities: { $slice: ["$activities", limit] }
                }
            },
            {
                $unwind: "$activities"
            },
            {
                $replaceRoot: { newRoot: "$activities" }
            },
            {
                $sort: { createdAt: -1 }
            },
            {
                $limit: 100
            }
        ]);

        await ActivityLog.populate(activities, [
            {
                path: "userId",
                select: "name email designation"
            },
            {
                path: "targetId",
                select: "title dynamicFields status"
            }
        ]);

        res.json({ success: true, activities });
    } catch (error) {
        console.error("Error fetching all activity logs:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch activity logs",
        });
    }
});

// Get activity count for a user
router.get("/user/:userId/count", async (req, res) => {
    try {
        const userId = req.params.userId;
        const timeframe = req.query.timeframe || 24; // hours

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        const teamMemberIds = await getTeamMemberIds(userId, user.designation);

        const cutoffTime = new Date();
        cutoffTime.setHours(cutoffTime.getHours() - timeframe);

        const count = await ActivityLog.countDocuments({
            userId: { $in: teamMemberIds },
            createdAt: { $gte: cutoffTime },
        });

        res.json({ success: true, count });
    } catch (error) {
        console.error("Error fetching activity count:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch activity count",
        });
    }
});

// Get activities across all candidates for a specific date
router.get("/timeline-by-date", async (req, res) => {
    try {
        const { date, role, action, search, userId } = req.query;
        
        if (!date) {
            return res.status(400).json({ success: false, message: "Date is required" });
        }

        const targetDate = new Date(date);
        const nextDate = new Date(targetDate);
        nextDate.setDate(nextDate.getDate() + 1);

        // Fetch logs
        const logsQuery = {
            targetModel: "CandidateByJob",
            createdAt: { $gte: targetDate, $lt: nextDate }
        };

        if (action && action !== "all") {
            logsQuery.actionType = action;
        }
        if (userId) {
            logsQuery.userId = userId;
        }

        const logs = await ActivityLog.find(logsQuery)
            .populate("userId", "name email designation profilePhoto")
            .populate({
                path: "targetId",
                select: "dynamicFields status jobId",
                populate: {
                    path: "jobId",
                    select: "title clientId",
                    populate: { path: "clientId", select: "name clientName" }
                }
            })
            .sort({ createdAt: -1 })
            .lean();

        // Convert logs to timeline activities
        let activities = [];
        for (const log of logs) {
            if (!log.targetId) continue;
            
            // Reconstruct candidate summary format for the buildActivityFromLog function
            const candidate = {
                _id: log.targetId._id,
                status: log.targetId.status,
                jobId: log.targetId.jobId
            };
            
            const activity = buildActivityFromLog(log, candidate);
            
            // Re-add candidate dynamic fields to activity so frontend can display candidate info
            const nameFields = log.targetId.dynamicFields || {};
            const candidateName = nameFields.candidateName || nameFields.CandidateName || nameFields.Name || nameFields.name || "Unnamed Candidate";
            
            activity.candidate = {
                _id: candidate._id,
                name: candidateName
            };

            activities.push(activity);
        }

        if (role && role !== "All") {
            activities = activities.filter(a => a.user?.role === role);
        }
        if (search) {
            const needle = search.toLowerCase();
            activities = activities.filter(a => {
                const haystack = [
                    a.title, a.description, a.actionLabel, a.user?.name, a.candidate?.name
                ].join(" ").toLowerCase();
                return haystack.includes(needle);
            });
        }
        
        activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json({ success: true, activities });
    } catch (error) {
        console.error("Error fetching timeline by date:", error);
        res.status(500).json({ success: false, message: "Failed to fetch timeline by date" });
    }
});

module.exports = router;
