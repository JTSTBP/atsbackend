const express = require("express");
const User = require("../models/Users");
const ActivityLog = require("../models/activitylog");
const Attendance = require("../models/Attendance");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { protect } = require("../middleware/authMiddleware");
const profileUpload = require("../middleware/profileUpload");
const { s3, deleteFile, getSignedUrl } = require("../config/s3Config");

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Populate reporter details when fetching user
    const user = await User.findOne({ email })
      .select("+password")
      .populate("reporter", "name email designation"); // specify fields to include

    if (!user)
      return res.status(400).json({ message: "User not found or wrong role" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid password" });

    // Check if user account is disabled
    if (user.isDisabled) {
      return res.status(403).json({
        success: false,
        message: "Your account has been disabled. Please contact the administrator."
      });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // 📋 Track attendance - record login time (skip for Admin users)
    if (user.designation !== "Admin") {
      try {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        const currentTime = now.toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        let attendance = await Attendance.findOne({
          user: user._id,
          date: { $gte: startOfDay, $lte: endOfDay },
        });

        if (attendance) {
          // Check if there's an active session and auto-logout
          const activeSession = attendance.sessions.find((s) => s.isActive);
          if (activeSession) {
            activeSession.logoutTime = currentTime;
            activeSession.isActive = false;
          }

          // Add new session
          attendance.sessions.push({
            loginTime: currentTime,
            isActive: true,
          });
        } else {
          // Create new attendance record
          attendance = new Attendance({
            user: user._id,
            date: startOfDay,
            sessions: [
              {
                loginTime: currentTime,
                isActive: true,
              },
            ],
          });
        }

        await attendance.save();
      } catch (attendanceError) {
        console.error("Error tracking attendance:", attendanceError);
        // Don't fail login if attendance tracking fails
      }
    }

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        designation: user.designation,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt,
        profilePhoto: getSignedUrl(user.profilePhoto),
        phone: user.phone || (user.phoneNumber ? user.phoneNumber.official || user.phoneNumber.personal : ""),
        department: user.department,
        joinDate: user.joinDate || user.dateOfJoining,
        appPassword: user.appPassword,
        reporter: user.reporter // populated reporter info
          ? {
            _id: user.reporter._id,
            name: user.reporter.name,
            email: user.reporter.email,
            designation: user.reporter.designation,
          }
          : null,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});
router.get("/activity-logs", async (req, res) => {
  try {
    const logs = await ActivityLog.find()
      .populate("userId", "name email role")
      .populate("targetId") // Mongoose now knows correct model (Candidate, Job, etc.)
      .sort({ createdAt: -1 })


    res.json({
      success: true,
      logs,
    });
  } catch (error) {
    console.error("Error fetching activity logs:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch logs",
    });
  }
});

// 🚪 Logout Route - Track attendance logout
router.post("/logout", protect, async (req, res) => {
  try {
    const userId = req.user._id;

    // Track attendance logout (skip for Admin users)
    if (req.user && req.user.designation !== "Admin") {
      try {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        const currentTime = now.toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        const attendance = await Attendance.findOne({
          user: userId,
          date: { $gte: startOfDay, $lte: endOfDay },
        });

        if (attendance) {
          const activeSession = attendance.sessions.find((s) => s.isActive);
          if (activeSession) {
            activeSession.logoutTime = currentTime;
            activeSession.isActive = false;
            await attendance.save();
          }
        }
      } catch (attendanceError) {
        console.error("Error tracking logout:", attendanceError);
        // Don't fail logout if attendance tracking fails
      }
    }

    res.status(200).json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// 🔹 Update Profile Route
router.put(
  "/update-profile",
  protect,
  profileUpload.single("profilePhoto"),
  async (req, res) => {
    try {

      const user = await User.findById(req.user._id);

      if (user) {
        user.name = req.body.name || user.name;
        user.email = req.body.email || user.email;
        user.phone = req.body.phone || user.phone;
        user.department = req.body.department || user.department;
        user.joinDate = req.body.joinDate || user.joinDate;
        user.appPassword = req.body.appPassword || user.appPassword;

        // Sync older field names for compatibility
        if (req.body.joinDate) user.dateOfJoining = req.body.joinDate;
        if (req.body.phone) {
          if (!user.phoneNumber) user.phoneNumber = {};
          user.phoneNumber.official = req.body.phone;
        }

        // 🗑️ REMOVE PHOTO
        if (req.body.removePhoto === "true") {
          user.profilePhoto = null;
        }

        // 📤 NEW UPLOADED PHOTO
        if (req.file) {
          console.log("✅ New file uploaded:", req.file.location || req.file.path);

          // DELETE OLD PHOTO if exists
          if (user.profilePhoto) {
            await deleteFile(user.profilePhoto);
          }

          user.profilePhoto = req.file.location || req.file.path;
        }


        const updatedUser = await user.save();
        console.log("✅ User updated successfully");

        res.json({
          success: true,
          user: {
            _id: updatedUser._id,
            name: updatedUser.name,
            email: updatedUser.email,
            phone: updatedUser.phone,
            designation: updatedUser.designation,
            department: updatedUser.department,
            joinDate: updatedUser.joinDate,
            profilePhoto: getSignedUrl(updatedUser.profilePhoto),
            appPassword: updatedUser.appPassword,
            isAdmin: updatedUser.isAdmin,
            createdAt: updatedUser.createdAt,
          },
        });
      } else {
        res.status(404).json({ message: "User not found" });
      }
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  }
);


module.exports = router;
