const ActivityLog = require("../models/activitylog");

async function logActivity(
  userId,
  action,
  module,
  description,
    targetId = null,
  targetModel
) {
  try {
    await ActivityLog.create({
      userId,
      action,
      module,
      description,
      targetId,
      targetModel,
    });
  } catch (error) {
    console.error("Activity log error:", error);
  }
}

module.exports = logActivity;
