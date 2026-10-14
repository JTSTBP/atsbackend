const idOf = value => String(value?._id || value || "");
const idsOf = values => [...new Set((values || []).map(idOf).filter(Boolean))];

const mergeMentorAssignments = (job, changes, mentorId, teamIds) => {
  const ownId = idOf(mentorId);
  const team = new Set(idsOf(teamIds));
  const records = job.mentorAssignments instanceof Map
    ? Object.fromEntries(job.mentorAssignments) : { ...(job.mentorAssignments || {}) };
  const previous = records[ownId];
  const ownRecruiters = idsOf(changes.assignedRecruiters).filter(id => team.has(id));
  const lead = idOf(changes.leadRecruiter);
  if (!ownRecruiters.length || !ownRecruiters.includes(lead)) {
    throw Object.assign(new Error("Select your team's recruiters and a lead from those recruiters"), { status: 400 });
  }
  const others = Object.entries(records).filter(([key]) => key !== ownId).flatMap(([, value]) => idsOf(value.assignedRecruiters));
  const previousOwn = new Set(previous ? idsOf(previous.assignedRecruiters) : idsOf(job.assignedRecruiters).filter(id => team.has(id)));
  const preserved = idsOf(job.assignedRecruiters).filter(id => !previousOwn.has(id) || others.includes(id));
  records[ownId] = { mentorId: ownId, assignedRecruiters: ownRecruiters, leadRecruiter: lead };
  const combined = idsOf([...preserved, ...others, ...ownRecruiters]);
  const oldLead = idOf(job.leadRecruiter);
  return {
    assignedRecruiters: combined,
    assignedMentors: idsOf(job.assignedMentors),
    // Keep the existing overall lead for legacy views; each mentor has their own lead below.
    leadRecruiter: combined.includes(oldLead) ? oldLead : lead,
    mentorAssignments: records,
  };
};

module.exports = { mergeMentorAssignments };
