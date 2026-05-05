const express = require("express");
const LeaveApplication = require("../models/Leaves");
const User = require("../models/Users");
const logActivity = require("./logactivity");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const leaves = await LeaveApplication.find()
      .sort({ createdAt: -1 })
      .populate({
        path: "user",
        select: "name email reporter designation",
        populate: {
          path: "reporter",
          select: "name email role", // add fields you need
        },
      })
      .populate("reporter", "name designation");
    res.status(200).json(leaves);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// 📩 Apply for Leave
router.post("/apply", async (req, res) => {
  try {
    const {
      user,
      leaveType,
      fromDate,
      toDate,
      reason,
      reporter,
      leaveCategory,
      halfDayPeriod,
    } = req.body;

    const usergiv = await User.findById(user);
    if (!usergiv) return res.status(404).json({ message: "User not found" });

    const leave = new LeaveApplication({
      user,
      leaveType,
      fromDate,
      toDate,
      reason,
      reporter,
      leaveCategory,
      halfDayPeriod,
    });

    await leave.save();
    logActivity(
      user,
      "Apply Leave",
      "Leave Management",
      `${usergiv.name} applied for ${leaveType} (${leaveCategory}${leaveCategory === "Half Day" ? ` - ${halfDayPeriod}` : ""
      }) from ${fromDate} to ${toDate}`,
      leave._id,
      "LeaveApplication"
    );

    res.status(201).json({ message: "Leave application submitted", leave });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.get("/user/:userId", async (req, res) => {
  try {
    const leaves = await LeaveApplication.find({
      user: req.params.userId,
    })
      .sort({ createdAt: -1 })
      .populate("reporter", "name designation");
    res.status(200).json(leaves);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// 📄 Get all leaves of a user
router.get("/user/:userId", async (req, res) => {
  try {
    const leaves = await LeaveApplication.find({
      user: req.params.userId,
    })
      .sort({ createdAt: -1 })
      .populate("reporter", "name designation");
    res.status(200).json(leaves);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});
// 🧾 Get leaves assigned to a reporter (Manager/HR)
router.get("/reporter/:reporterId", async (req, res) => {
  try {
    const leaves = await LeaveApplication.find({
      "reporter._id": req.params.reporterId,
    }).sort({
      createdAt: -1,
    });
    res.status(200).json(leaves);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ✅ Update leave status (Approve/Reject)
router.put("/:leaveId/status", async (req, res) => {
  try {
    const { status, role } = req.body;
    const leave = await LeaveApplication.findById(req.params.leaveId);
    if (!leave) return res.status(404).json({ message: "Leave not found" });

    leave.status = status;
    leave.statusUpdated = role;
    const leaveapply = await User.findOne({ _id: leave.user });
    await leave.save();
    logActivity(
      role, // userId (admin/HR)
      "Update Leave Status", // action
      "Leave Management", // module
      `Leave request by user ${leaveapply.name} was updated to "${status}"`, // description
      leave._id, // targetId
      "LeaveApplication" // targetModel
    );

    res
      .status(200)
      .json({ message: `Leave ${status.toLowerCase()} successfully`, leave });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});
// 🧑‍💼 Get all possible reporters (for dropdown)
router.get("/reporters", async (req, res) => {
  try {
    const reporters = await User.find({
      designation: { $in: ["Manager", "HR"] },
    })
      .select("_id name email designation")
      .sort({ name: 1 });

    res.status(200).json(reporters);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// 🗑️ Delete Leave Application
router.delete("/:leaveId", async (req, res) => {
  try {
    const leaveId = req.params.leaveId;
    const { userId } = req.query; // Admin/Mentor ID for logging

    const leave = await LeaveApplication.findById(leaveId).populate("user", "name");
    if (!leave) return res.status(404).json({ message: "Leave application not found" });

    await LeaveApplication.findByIdAndDelete(leaveId);

    if (userId) {
      logActivity(
        userId,
        "Delete Leave",
        "Leave Management",
        `Deleted leave application for ${leave.user?.name || "Unknown User"}`,
        leaveId,
        "LeaveApplication"
      );
    }

    res.status(200).json({ message: "Leave application deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// 🗑️ Bulk Delete Leave Applications
router.post("/bulk-delete", async (req, res) => {
  try {
    const { leaveIds, userId } = req.body;

    if (!Array.isArray(leaveIds) || leaveIds.length === 0) {
      return res.status(400).json({ message: "No leave IDs provided" });
    }

    await LeaveApplication.deleteMany({ _id: { $in: leaveIds } });

    if (userId) {
      logActivity(
        userId,
        "Bulk Delete Leaves",
        "Leave Management",
        `Successfully deleted ${leaveIds.length} leave application(s)`,
        null,
        "LeaveApplication"
      );
    }

    res.status(200).json({ message: `${leaveIds.length} leave application(s) deleted successfully` });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
