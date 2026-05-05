const express = require("express");
const User = require("../models/Users");
const bcrypt = require("bcryptjs");

const router = express.Router();

// ➕ Create New User
router.post("/", async (req, res) => {
  try {
    const { name, email, designation, password, reporter, isAdmin, personalEmail, phoneNumber, phone, department, joinDate, dateOfJoining, dateOfBirth, appPassword } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const newUser = await User.create({
      name,
      email,
      designation,
      password,
      reporter: reporter || null,
      isAdmin: isAdmin || false,
      personalEmail,
      phoneNumber,
      phone: phone || (phoneNumber ? phoneNumber.official || phoneNumber.personal : ""),
      department,
      dateOfJoining: dateOfJoining || joinDate,
      joinDate: joinDate || dateOfJoining,
      dateOfBirth,
      appPassword,
    });

    res.status(201).json(newUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
});

// 📋 Get All Users
// 📋 Get All Users (with Pagination & Filtering)
router.get("/", async (req, res) => {
  try {
    const { page, limit, search, role, isAdmin, reporter } = req.query;

    // Build Query
    const query = {};

    // Search (Name or Designation or Email)
    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [
        { name: searchRegex },
        { designation: searchRegex },
        { email: searchRegex }
      ];
    }

    // Role Filter
    if (role) {
      query.designation = new RegExp(`^${role}$`, "i"); // Case-insensitive exact match
    }

    // Admin Filter
    if (isAdmin !== undefined) {
      query.isAdmin = isAdmin === "true";
    }

    // Reporter Filter
    if (reporter) {
      query.reporter = reporter;
    }

    // If Pagination params are present
    if (page && limit) {
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;

      const users = await User.find(query)
        .sort({ createdAt: -1 })
        .populate("reporter", "name designation")
        .skip(skip)
        .limit(limitNum);

      const totalUsers = await User.countDocuments(query);

      return res.json({
        users,
        totalUsers,
        totalPages: Math.ceil(totalUsers / limitNum),
        currentPage: pageNum
      });
    }

    // Default: Return All Users (Backward Compatibility)
    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .populate("reporter", "name designation");

    res.json(users);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server Error" });
  }
});

router.put("/:id", async (req, res) => {
  const { name, email, designation, reporter, password, isAdmin, personalEmail, phoneNumber, phone, department, joinDate, dateOfJoining, dateOfBirth, appPassword, isDisabled } = req.body;

  try {
    let user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ msg: "User not found" });

    // Check if email exists but ignore the same user
    const existingUser = await User.findOne({
      email,
      _id: { $ne: req.params.id }
    });

    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    user.name = name || user.name;
    user.email = email || user.email;
    user.designation = designation || user.designation;
    user.reporter = reporter || user.reporter;
    user.isAdmin = isAdmin !== undefined ? isAdmin : user.isAdmin;
    user.personalEmail = personalEmail || user.personalEmail;
    user.phoneNumber = phoneNumber || user.phoneNumber;
    user.phone = phone || user.phone;
    user.department = department || user.department;
    user.dateOfJoining = dateOfJoining || joinDate || user.dateOfJoining;
    user.joinDate = joinDate || dateOfJoining || user.joinDate;
    user.dateOfBirth = dateOfBirth || user.dateOfBirth;
    user.appPassword = appPassword || user.appPassword;
    user.isDisabled = isDisabled !== undefined ? isDisabled : user.isDisabled;

    // Sync sub-fields if phone is provided
    if (phone && !phoneNumber) {
      if (!user.phoneNumber) user.phoneNumber = {};
      user.phoneNumber.official = phone;
    }

    // Update password if provided
    if (password) {
      user.password = password;
    }

    await user.save();
    res.json(user);
  } catch (err) {
    console.log(err);
    res.status(500).json({ msg: "Server error" });
  }
});


// delete
router.delete("/:id", async (req, res) => {
  const userId = req.params.id;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    await User.findByIdAndDelete(userId);
    res.status(200).json({ msg: "User deleted successfully" });
  } catch (err) {
    console.error("Error deleting user:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// 🔄 Toggle User Status (Enable/Disable)
router.patch("/:id/toggle-status", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ msg: "User not found" });

    user.isDisabled = !user.isDisabled;
    await user.save();

    res.json({
      success: true,
      message: `User ${user.isDisabled ? "disabled" : "enabled"} successfully`,
      isDisabled: user.isDisabled
    });
  } catch (err) {
    console.error("Error toggling user status:", err);
    res.status(500).json({ msg: "Server error" });
  }
});





module.exports = router;
