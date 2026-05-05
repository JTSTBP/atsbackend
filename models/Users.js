const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Name is required"],
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      "Please provide a valid email",
    ],
  },
  designation: {
    type: String,
    enum: ["Mentor", "Recruiter", "Manager", "Admin", "Finance"],
    required: [true, "Designation is required"],
  },
  reporter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  password: {
    type: String,
    required: [true, "Password is required"],
    minlength: 6,
    select: false, // Don't return password in queries by default
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  isAdmin: {
    type: Boolean,
    default: false,
  },
  personalEmail: {
    type: String,
  },
  phoneNumber: {
    personal: String,
    official: String,
  },
  phone: {
    type: String,
  },
  department: {
    type: String,
  },
  dateOfJoining: {
    type: Date,
  },
  joinDate: {
    type: Date,
  },
  dateOfBirth: {
    type: Date,
  },
  profilePhoto: {
    type: String,
  },
  appPassword: {
    type: String,
  },
  isDisabled: {
    type: Boolean,
    default: false,
  },
});


// Encrypt password using bcrypt before saving
UserSchema.pre("save", async function (next) {
  // Only hash the password if it's modified (or new)
  if (!this.isModified("password")) {
    return next();
  }

  try {
    // Generate salt
    const salt = await bcrypt.genSalt(10);
    // Hash password with salt
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to check if entered password matches with stored hashed password
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", UserSchema);
