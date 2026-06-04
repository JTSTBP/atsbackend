const mongoose = require("mongoose");

const sourceCandidateSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
    },
    UpdatedStatusBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    resumeUrl: String,
    linkedinUrl: String,
    portfolioUrl: String,
    notes: String,
    status: {
      type: String,
      enum: [
        "New",
        "Shortlisted",
        "Interviewed",
        "Selected",
        "Joined",
        "Rejected",
        "Dropped",
        "Hold",
      ],
      default: "New",
    },
    joiningDate: {
      type: Date,
    },
    rejectedBy: {
      type: String,
      enum: ["Client", "Mentor", "Manager", "Admin"],
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    droppedBy: {
      type: String,
      enum: ["Client", "Mentor", "Manager", "Admin"],
      default: null,
    },
    dynamicFields: {
      type: Object,
      default: {},
    },
    offerLetter: {
      type: String, // Path to the uploaded offer letter
    },
    selectionDate: {
      type: Date,
    },
    expectedJoiningDate: {
      type: Date,
    },
    interviewStage: {
      type: String,
      default: null,
    },
    interviewStageHistory: [
      {
        stageName: {
          type: String,
          required: true,
        },
        status: {
          type: String,
          enum: ["Selected", "Rejected"],
          required: true,
        },
        notes: {
          type: String,
          default: "",
        },
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    statusHistory: [
      {
        status: {
          type: String,
          required: true,
        },
        comment: {
          type: String,
          default: "",
        },
        joiningDate: {
          type: Date,
        },
        rejectionReason: {
          type: String,
        },
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    comments: [
      {
        text: String,
        author: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Source Candidate Specific Fields
    locationReferred: {
      type: String,
      required: true,
    },
    experience: {
      type: String,
      required: true,
    },
    expectedCtc: {
      type: String,
      required: true,
    },
    previousCtc: {
      type: String,
    },
    requirements: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SourceCandidate", sourceCandidateSchema);
