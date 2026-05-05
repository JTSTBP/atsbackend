// const mongoose = require("mongoose");
// const User = require("./Users");
// const Candidate = require("./CandidatesByJob");
// const Job = require("./Jobs");
// const Leave = require("./Leaves");

// const activityLogSchema = new mongoose.Schema({
//   userId: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: "User",
//     required: true,
//   },

//   action: { type: String, required: true }, // "created", "updated", "deleted", "approved"
//   module: { type: String, required: true }, // job, candidate, leave
//   description: { type: String },
//   targetId: {
//     type: mongoose.Schema.Types.ObjectId,
//     required: false,
//     refPath: "targetModel",
//   },
//   targetModel: {
//     type: String,
//     required: false, // required only if targetId exists
//     enum: ["CandidateByJob", "Job", "Leave"], // add all your models here
//   },
//   targetModel: { type: String, required: true }, // 'Candidate' | 'Job' | 'Leave' // jobId or candidateId or leaveId
// });

// module.exports = mongoose.model("ActivityLog", activityLogSchema);
const mongoose = require("mongoose");
require("./Users");
require("./CandidatesByJob");
require("./Jobs");
require("./Leaves");

const activityLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    action: { type: String, required: true }, // created, updated, deleted
    module: { type: String, required: true }, // job, candidate, leave
    description: { type: String },

    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "targetModel", // Dynamically populate
    },

    targetModel: {
      type: String,
      required: true,
      enum: ["CandidateByJob", "Job", "LeaveApplication"], // All allowed models
    },
  },
  {
    timestamps: true, // <-- Add createdAt & updatedAt automatically
  }
);

module.exports = mongoose.model("ActivityLog", activityLogSchema);
