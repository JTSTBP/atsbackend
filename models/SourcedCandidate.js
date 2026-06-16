const mongoose = require("mongoose");

const sourcedCandidateSchema = new mongoose.Schema(
  {
    recruiterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requirementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
    },
    resumeFileUrl: {
      type: String,
      default: null,
    },
    name: {
      type: String,
      default: null,
    },
    email: {
      type: String,
      default: null,
    },
    phoneNumber: {
      type: String,
      default: null,
    },
    education: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    skills: {
      type: [String],
      default: [],
    },
    experience: {
      type: String,
      default: null,
    },
    workHistory: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    location: {
      type: String,
      default: null,
    },
    designation: {
      type: String,
      default: null,
    },
    currentCompany: {
      type: String,
      default: null,
    },
    previousCompanies: {
      type: [String],
      default: [],
    },
    certifications: {
      type: [String],
      default: [],
    },
    linkedinProfile: {
      type: String,
      default: null,
    },
    noticePeriod: {
      type: String,
      default: null,
    },
    expectedSalary: {
      type: String,
      default: null,
    },
    sourceType: {
      type: String,
      default: "Resume Upload",
    },
    sourceIdentifier: {
      type: String,
      default: () => new mongoose.Types.ObjectId().toHexString()
    },
    additionalInfo: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("SourcedCandidate", sourcedCandidateSchema);
