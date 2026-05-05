const express = require("express");
const Session = require("../models/Session");
const User = require("../models/Users");

const router = express.Router();

// 📋 Get all sessions
router.get("/", async (req, res) => {
    try {
        const { startDate, endDate, userId, status } = req.query;

        let query = {};

        // Filter by date range
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        // Filter by user
        if (userId) query.user = userId;

        // Filter by status
        if (status) query.status = status;

        const sessions = await Session.find(query)
            .sort({ date: -1, createdAt: -1 })
            .populate("user", "name email designation")
            .populate("createdBy", "name");

        res.status(200).json(sessions);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// 📄 Get sessions for a specific user
router.get("/user/:userId", async (req, res) => {
    try {
        const sessions = await Session.find({ user: req.params.userId })
            .sort({ date: -1 })
            .populate("createdBy", "name");

        res.status(200).json(sessions);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// 📊 Get session statistics
router.get("/stats", async (req, res) => {
    try {
        const { userId, startDate, endDate } = req.query;

        let query = {};
        if (userId) query.user = userId;
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        const sessions = await Session.find(query);

        const stats = {
            totalSessions: sessions.length,
            present: sessions.filter(s => s.status === "Present").length,
            absent: sessions.filter(s => s.status === "Absent").length,
            halfDay: sessions.filter(s => s.status === "Half Day").length,
            leave: sessions.filter(s => s.status === "Leave").length,
        };

        res.status(200).json(stats);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// ➕ Create new session
router.post("/", async (req, res) => {
    try {
        const { user, date, loginTime, logoutTime, status, notes, createdBy } = req.body;

        // Verify user exists
        const userExists = await User.findById(user);
        if (!userExists) {
            return res.status(404).json({ message: "User not found" });
        }

        const session = new Session({
            user,
            date: date || new Date(),
            loginTime,
            logoutTime,
            status: status || "Present",
            notes,
            createdBy,
        });

        await session.save();

        // Populate user details before sending response
        await session.populate("user", "name email designation");
        await session.populate("createdBy", "name");

        res.status(201).json({ message: "Session created successfully", session });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// ✏️ Update session
router.put("/:id", async (req, res) => {
    try {
        const { loginTime, logoutTime, status, notes } = req.body;

        const session = await Session.findById(req.params.id);
        if (!session) {
            return res.status(404).json({ message: "Session not found" });
        }

        if (loginTime) session.loginTime = loginTime;
        if (logoutTime) session.logoutTime = logoutTime;
        if (status) session.status = status;
        if (notes !== undefined) session.notes = notes;

        await session.save();

        await session.populate("user", "name email designation");
        await session.populate("createdBy", "name");

        res.status(200).json({ message: "Session updated successfully", session });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// 🗑️ Delete session
router.delete("/:id", async (req, res) => {
    try {
        const session = await Session.findById(req.params.id);
        if (!session) {
            return res.status(404).json({ message: "Session not found" });
        }

        await Session.findByIdAndDelete(req.params.id);

        res.status(200).json({ message: "Session deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// 🚀 Auto-start session (called on login)
router.post("/start", async (req, res) => {
    try {
        const { userId } = req.body;

        // Check if user exists
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Get today's date (start and end of day)
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        // Check if a session already exists for this user today
        let session = await Session.findOne({
            user: userId,
            date: { $gte: startOfDay, $lte: endOfDay }
        });

        if (session) {
            // Session exists for today - reactivate it
            session.isActive = true;
            session.loginTime = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
            // Don't set logoutTime yet - it will be set when session ends
            session.logoutTime = undefined;
            await session.save();
            await session.populate("user", "name email designation");

            return res.status(200).json({ message: "Session resumed successfully", session });
        }

        // No session for today - end any old active sessions first
        const activeSessions = await Session.find({ user: userId, isActive: true });
        for (const activeSession of activeSessions) {
            activeSession.isActive = false;
            activeSession.logoutTime = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
            await activeSession.save();
        }

        // Create new session for today
        session = new Session({
            user: userId,
            date: now,
            loginTime: now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
            isActive: true,
            status: "Present",
        });

        await session.save();
        await session.populate("user", "name email designation");

        res.status(201).json({ message: "Session started successfully", session });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// 🛑 Auto-end session (called on logout/inactivity)
router.put("/end/:userId", async (req, res) => {
    try {
        const { userId } = req.params;

        // Find active session for this user
        const session = await Session.findOne({ user: userId, isActive: true });

        if (!session) {
            return res.status(404).json({ message: "No active session found" });
        }

        // End the session
        session.isActive = false;
        session.logoutTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

        await session.save();
        await session.populate("user", "name email designation");

        res.status(200).json({ message: "Session ended successfully", session });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

// 📍 Get active session for a user
router.get("/active/:userId", async (req, res) => {
    try {
        const session = await Session.findOne({
            user: req.params.userId,
            isActive: true
        }).populate("user", "name email designation");

        if (!session) {
            return res.status(404).json({ message: "No active session found" });
        }

        res.status(200).json(session);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
});

module.exports = router;
