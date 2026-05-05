const express = require("express");
const ActivityLog = require("../models/activitylog");
const User = require("../models/Users");
const router = express.Router();

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

module.exports = router;
