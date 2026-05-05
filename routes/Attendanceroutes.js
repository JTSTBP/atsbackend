const express = require("express");
const Attendance = require("../models/Attendance");
const User = require("../models/Users");

const router = express.Router();

// 📋 Get attendance report with filters
router.get("/report", async (req, res) => {
    try {
        const { startDate, endDate, userId } = req.query;

        // 1. Fetch non-admin user IDs to exclude them from the report
        const nonAdminUsers = await User.find({ designation: { $ne: "Admin" } }).select("_id");
        const nonAdminUserIds = nonAdminUsers.map(user => user._id);

        let query = { user: { $in: nonAdminUserIds } };

        // Filter by date range
        if (startDate || endDate) {
            query.date = {};
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                query.date.$gte = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.date.$lte = end;
            }
        }

        // Filter by user (if provided, ensures it's one of the non-admin users)
        if (userId) {
            query.user = userId;
        }

        const attendanceRecords = await Attendance.find(query)
            .sort({ date: -1 })
            .populate("user", "name email designation profilePhoto");

        res.status(200).json({
            success: true,
            count: attendanceRecords.length,
            data: attendanceRecords,
        });
    } catch (error) {
        console.error("Error fetching attendance report:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// 📄 Get attendance for a specific user
router.get("/user/:userId", async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        let query = { user: req.params.userId };

        // Filter by date range
        if (startDate || endDate) {
            query.date = {};
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                query.date.$gte = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.date.$lte = end;
            }
        }

        const attendanceRecords = await Attendance.find(query)
            .sort({ date: -1 })
            .populate("user", "name email designation profilePhoto");

        res.status(200).json({
            success: true,
            count: attendanceRecords.length,
            data: attendanceRecords,
        });
    } catch (error) {
        console.error("Error fetching user attendance:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// 📅 Get attendance for a specific day
router.get("/daily/:userId/:date", async (req, res) => {
    try {
        const { userId, date } = req.params;

        const targetDate = new Date(date);
        targetDate.setHours(0, 0, 0, 0);

        const endDate = new Date(targetDate);
        endDate.setHours(23, 59, 59, 999);

        const attendance = await Attendance.findOne({
            user: userId,
            date: { $gte: targetDate, $lte: endDate },
        }).populate("user", "name email designation profilePhoto");

        if (!attendance) {
            return res.status(404).json({
                success: false,
                message: "No attendance record found for this date",
            });
        }

        res.status(200).json({
            success: true,
            data: attendance,
        });
    } catch (error) {
        console.error("Error fetching daily attendance:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// 🚀 Record login (start session)
router.post("/login", async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "User ID is required",
            });
        }

        // Detect device type from User-Agent
        const userAgent = req.headers["user-agent"] || "";
        const isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
        const deviceType = isMobile ? "Phone" : "System";

        // Verify user exists
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        // 📋 Skip attendance tracking for Admin users
        if (user.designation === "Admin") {
            return res.status(200).json({
                success: true,
                message: "Attendance tracking skipped for Admin",
            });
        }

        // Get today's date (start and end of day)
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        // Format current time as HH:MM:SS
        const currentTime = now.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });

        // Check if attendance record exists for today
        let attendance = await Attendance.findOne({
            user: userId,
            date: { $gte: startOfDay, $lte: endOfDay },
        });

        if (attendance) {
            // Check if there's an active session
            const activeSession = attendance.sessions.find((s) => s.isActive);

            if (activeSession) {
                // Auto-logout the active session first
                activeSession.logoutTime = currentTime;
                activeSession.isActive = false;
            }

            // Add new session
            attendance.sessions.push({
                loginTime: currentTime,
                isActive: true,
                deviceType: deviceType,
            });

            await attendance.save();
            await attendance.populate("user", "name email designation profilePhoto");

            return res.status(200).json({
                success: true,
                message: "New session started",
                data: attendance,
            });
        }

        // Create new attendance record for today
        attendance = new Attendance({
            user: userId,
            date: startOfDay,
            sessions: [
                {
                    loginTime: currentTime,
                    isActive: true,
                    deviceType: deviceType,
                },
            ],
        });

        await attendance.save();
        await attendance.populate("user", "name email designation profilePhoto");

        res.status(201).json({
            success: true,
            message: "Attendance started successfully",
            data: attendance,
        });
    } catch (error) {
        console.error("Error recording login:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// 🛑 Record logout (end session)
router.post("/logout", async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "User ID is required",
            });
        }

        // Verify user exists and check designation
        const user = await User.findById(userId);
        if (user && user.designation === "Admin") {
            return res.status(200).json({
                success: true,
                message: "Attendance tracking skipped for Admin",
            });
        }

        // Get today's date range
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        // Format current time
        const currentTime = now.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });

        // Find today's attendance record
        const attendance = await Attendance.findOne({
            user: userId,
            date: { $gte: startOfDay, $lte: endOfDay },
        });

        if (!attendance) {
            return res.status(404).json({
                success: false,
                message: "No active attendance record found for today",
            });
        }

        // Find active session
        const activeSession = attendance.sessions.find((s) => s.isActive);

        if (!activeSession) {
            return res.status(404).json({
                success: false,
                message: "No active session found",
            });
        }

        // End the session
        activeSession.logoutTime = currentTime;
        activeSession.isActive = false;

        await attendance.save();
        await attendance.populate("user", "name email designation profilePhoto");

        res.status(200).json({
            success: true,
            message: "Session ended successfully",
            data: attendance,
        });
    } catch (error) {
        console.error("Error recording logout:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// 📊 Get attendance statistics
router.get("/stats", async (req, res) => {
    try {
        const { userId, startDate, endDate } = req.query;

        let query = {};

        if (userId) {
            query.user = userId;
        }

        if (startDate || endDate) {
            query.date = {};
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                query.date.$gte = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.date.$lte = end;
            }
        }

        const attendanceRecords = await Attendance.find(query);

        const stats = {
            totalDays: attendanceRecords.length,
            present: attendanceRecords.filter((a) => a.status === "Present").length,
            absent: attendanceRecords.filter((a) => a.status === "Absent").length,
            halfDay: attendanceRecords.filter((a) => a.status === "Half Day").length,
            leave: attendanceRecords.filter((a) => a.status === "Leave").length,
        };

        res.status(200).json({
            success: true,
            data: stats,
        });
    } catch (error) {
        console.error("Error fetching attendance stats:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ✏️ Update attendance (admin only - for corrections)
router.put("/:id", async (req, res) => {
    try {
        const { sessions, status } = req.body;

        const attendance = await Attendance.findById(req.params.id);

        if (!attendance) {
            return res.status(404).json({
                success: false,
                message: "Attendance record not found",
            });
        }

        if (sessions) {
            attendance.sessions = sessions;
        }

        if (status) {
            attendance.status = status;
        }

        await attendance.save();
        await attendance.populate("user", "name email designation profilePhoto");

        res.status(200).json({
            success: true,
            message: "Attendance updated successfully",
            data: attendance,
        });
    } catch (error) {
        console.error("Error updating attendance:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// 🗑️ Delete attendance record (admin only)
router.delete("/:id", async (req, res) => {
    try {
        const attendance = await Attendance.findById(req.params.id);

        if (!attendance) {
            return res.status(404).json({
                success: false,
                message: "Attendance record not found",
            });
        }

        await Attendance.findByIdAndDelete(req.params.id);

        res.status(200).json({
            success: true,
            message: "Attendance record deleted successfully",
        });
    } catch (error) {
        console.error("Error deleting attendance:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

module.exports = router;
