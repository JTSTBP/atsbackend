const ActivityLog = require("../models/activitylog");

async function logActivity(
  userId,
  action,
  module,
  description,
  targetId = null,
  targetModel,
  details = {}
) {
  try {
    if (!userId) {
      console.warn("Activity log skipped: missing userId", {
        action,
        module,
        targetId,
      });
      return;
    }

    await ActivityLog.create({
      userId,
      action,
      module,
      description,
      targetId,
      targetModel,
      candidateId:
        details.candidateId ||
        (targetModel === "CandidateByJob" ? targetId : undefined),
      jobId: details.jobId,
      actionType: details.actionType || module || action,
      performedByRole: details.performedByRole,
      previousValue: details.previousValue,
      newValue: details.newValue,
      metadata: details.metadata || {},
    });
  } catch (error) {
    console.error("Activity log error:", error);
  }
}

module.exports = logActivity;
