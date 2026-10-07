const Job = require("../models/Jobs");
const Candidate = require("../models/CandidatesByJob");
const User = require("../models/Users");
const PDFDocument = require("pdfkit");
const CeoDailyReportSettings = require("../models/CeoDailyReportSettings");
const CeoDailyReportLog = require("../models/CeoDailyReportLog");
const { sendMail, formatEmailErrorResponse } = require("./emailService");

const REPORT_TYPE = "ceo_daily_ats_performance";
const DEFAULT_TIMEZONE = "Asia/Kolkata";
const ACTIVE_JOB_STATUSES = ["Open"];
const BASE_STATUS_COLUMNS = ["Applied", "Screened", "Interview", "Shortlisted", "Selected", "Rejected", "Joined"];

const pad = (value) => String(value).padStart(2, "0");

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const normalizeList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const getDatePartsInTimezone = (date = new Date(), timezone = DEFAULT_TIMEZONE) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
};

const getTimezoneOffset = (timezone) => {
  if (timezone === "Asia/Kolkata" || timezone === "Asia/Calcutta") return "+05:30";
  return "+00:00";
};

const makeZonedDate = ({ year, month, day, hour = 0, minute = 0, timezone = DEFAULT_TIMEZONE }) => (
  new Date(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${getTimezoneOffset(timezone)}`)
);

const formatReportDate = (date, timezone = DEFAULT_TIMEZONE) => new Intl.DateTimeFormat("en-IN", {
  timeZone: timezone,
  day: "2-digit",
  month: "short",
  year: "numeric",
}).format(date);

const formatTime = (date, timezone = DEFAULT_TIMEZONE) => new Intl.DateTimeFormat("en-IN", {
  timeZone: timezone,
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
}).format(date);

const getDailyReportPeriod = ({ slot, timezone = DEFAULT_TIMEZONE, referenceDate = new Date() }) => {
  const parts = getDatePartsInTimezone(referenceDate, timezone);
  const endHour = slot === "7PM" ? 19 : 12;
  const start = makeZonedDate({ ...parts, hour: 0, minute: 0, timezone });
  const end = makeZonedDate({ ...parts, hour: endHour, minute: 0, timezone });
  const reportDate = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;

  return {
    reportDate,
    reportLabel: slot === "7PM" ? "7 PM" : "12 PM",
    title: `ATS Daily Performance Report - ${slot === "7PM" ? "7 PM" : "12 PM"}`,
    start,
    end,
    timezone,
    dateDisplay: formatReportDate(start, timezone),
  };
};

const isWorkingDay = (date = new Date(), timezone = DEFAULT_TIMEZONE) => {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(date);
  return weekday !== "Sun";
};

const normalizeStatus = (status) => {
  const value = String(status || "").trim();
  const lower = value.toLowerCase();
  if (!value) return "Unknown";
  if (["new", "applied"].includes(lower)) return "Applied";
  if (["screen", "screened", "screening"].includes(lower)) return "Screened";
  if (["interview", "interviewed"].includes(lower)) return "Interview";
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const getCandidateName = (candidate) => (
  candidate.dynamicFields?.candidateName ||
  candidate.dynamicFields?.CandidateName ||
  candidate.dynamicFields?.Name ||
  candidate.dynamicFields?.name ||
  "Unnamed Candidate"
);

const getSettings = async () => {
  let settings = await CeoDailyReportSettings.findOne();
  if (!settings) {
    settings = await CeoDailyReportSettings.create({
      emailRecipients: normalizeList(process.env.CEO_DAILY_REPORT_RECIPIENTS || process.env.SENDER_ID),
      ccRecipients: normalizeList(process.env.CEO_DAILY_REPORT_CC),
      timezone: process.env.CEO_DAILY_REPORT_TIMEZONE || DEFAULT_TIMEZONE,
      dashboardUrl: process.env.CEO_DAILY_REPORT_DASHBOARD_URL || process.env.FRONTEND_URL || "",
    });
  }
  return settings;
};

const updateSettings = async (payload, userId) => {
  const settings = await getSettings();
  const updates = {
    enable12PmReport: Boolean(payload.enable12PmReport),
    enable7PmReport: Boolean(payload.enable7PmReport),
    emailRecipients: normalizeList(payload.emailRecipients),
    ccRecipients: normalizeList(payload.ccRecipients),
    timezone: payload.timezone || DEFAULT_TIMEZONE,
    dashboardUrl: payload.dashboardUrl || "",
    updatedBy: userId,
  };

  Object.assign(settings, updates);
  await settings.save();
  return settings;
};

const buildStatusColumns = (statusTotals) => {
  const dynamicStatuses = Object.keys(statusTotals).filter((status) => !BASE_STATUS_COLUMNS.includes(status));
  return [...BASE_STATUS_COLUMNS, ...dynamicStatuses.sort()];
};

const hasActiveRecruiterAssignment = (job, activeRecruiterIdSet) => {
  const assignedRecruiters = (job.assignedRecruiters || []).map((id) => String(id));
  const leadRecruiterId = String(job.leadRecruiter || "");

  return assignedRecruiters.some((id) => activeRecruiterIdSet.has(id)) ||
    activeRecruiterIdSet.has(leadRecruiterId);
};

const generateCeoDailyReportData = async ({ slot = "12PM", referenceDate = new Date(), timezone = DEFAULT_TIMEZONE } = {}) => {
  const period = getDailyReportPeriod({ slot, referenceDate, timezone });
  const recruiters = await User.find({ designation: /^Recruiter$/i, isDisabled: { $ne: true } }).select("_id name email designation").lean();
  const mentors = await User.find({ designation: /^Mentor$/i, isDisabled: { $ne: true } }).select("_id name email designation").lean();
  const activeRecruiterIdSet = new Set(recruiters.map((recruiter) => String(recruiter._id)));
  const activeMentorIdSet = new Set(mentors.map((mentor) => String(mentor._id)));
  const activeJobs = (await Job.find({ status: { $in: ACTIVE_JOB_STATUSES } })
    .select("_id title status noOfPositions assignedRecruiters leadRecruiter CreatedBy createdAt")
    .lean())
    .filter((job) => (
      activeMentorIdSet.has(String(job.CreatedBy || "")) ||
      hasActiveRecruiterAssignment(job, activeRecruiterIdSet)
    ));

  const activeJobIds = activeJobs.map((job) => job._id);
  const activeJobIdSet = new Set(activeJobIds.map((id) => String(id)));
  const candidates = activeJobIds.length
    ? await Candidate.find({ jobId: { $in: activeJobIds } })
      .select("_id jobId createdBy createdAt status joiningDate statusHistory dynamicFields")
      .populate("jobId", "title")
      .lean()
    : [];

  const recruiterRows = recruiters.map((recruiter) => {
    const recruiterId = String(recruiter._id);
    const assignedJobs = activeJobs.filter((job) => {
      const assigned = (job.assignedRecruiters || []).map((id) => String(id));
      return assigned.includes(recruiterId) || String(job.leadRecruiter || "") === recruiterId;
    });
    const assignedJobIds = new Set(assignedJobs.map((job) => String(job._id)));
    const recruiterCandidates = candidates.filter((candidate) => (
      String(candidate.createdBy || "") === recruiterId &&
      candidate.jobId &&
      activeJobIdSet.has(String(candidate.jobId._id || candidate.jobId))
    ));
    const recruiterAssignedCandidates = recruiterCandidates.filter((candidate) => (
      assignedJobIds.has(String(candidate.jobId?._id || candidate.jobId))
    ));
    const todayUploads = recruiterAssignedCandidates.filter((candidate) => (
      candidate.createdAt >= period.start &&
      candidate.createdAt <= period.end
    ));
    const statusCounts = {};
    const joinedToday = [];

    recruiterAssignedCandidates.forEach((candidate) => {
      (candidate.statusHistory || []).forEach((entry) => {
        if (!entry.timestamp || entry.timestamp < period.start || entry.timestamp > period.end) return;
        const normalized = normalizeStatus(entry.status);
        statusCounts[normalized] = (statusCounts[normalized] || 0) + 1;
        if (normalized === "Joined") {
          joinedToday.push({
            candidateName: getCandidateName(candidate),
            jobTitle: candidate.jobId?.title || "N/A",
            joiningTime: formatTime(entry.timestamp, timezone),
            timestamp: entry.timestamp,
          });
        }
      });
    });

    return {
      recruiterId,
      recruiterName: recruiter.name,
      activeRequirements: assignedJobs.length,
      totalUploadsActiveRequirements: recruiterAssignedCandidates.length,
      todaysUploads: todayUploads.length,
      statusCounts,
      joinedToday,
    };
  });

  const mentorRows = mentors.map((mentor) => {
    const mentorId = String(mentor._id);
    const mentorActiveJobs = activeJobs.filter((job) => String(job.CreatedBy || "") === mentorId);
    const jobsCreatedToday = mentorActiveJobs.filter((job) => job.createdAt >= period.start && job.createdAt <= period.end).length;
    
    const mentorActiveJobIds = new Set(mentorActiveJobs.map((job) => String(job._id)));
    const joinedCandidatesCount = candidates.filter((candidate) => 
      mentorActiveJobIds.has(String(candidate.jobId?._id || candidate.jobId)) && 
      normalizeStatus(candidate.status) === "Joined"
    ).length;
    const totalPositions = mentorActiveJobs.reduce((sum, job) => sum + (Number(job.noOfPositions) || 0), 0);
    const activeOpeningsNow = Math.max(0, totalPositions - joinedCandidatesCount);

    return {
      mentorId,
      mentorName: mentor.name,
      jobsCreatedToday,
      activeRequirementsNow: mentorActiveJobs.length,
      activeOpeningsNow,
    };
  });

  const statusTotals = {};
  recruiterRows.forEach((row) => {
    Object.entries(row.statusCounts).forEach(([status, count]) => {
      statusTotals[status] = (statusTotals[status] || 0) + count;
    });
  });

  const totalJoinedToday = recruiterRows.reduce((sum, row) => sum + row.joinedToday.length, 0);
  const mentorActiveJobIdSet = new Set(
    activeJobs
      .filter((job) => activeMentorIdSet.has(String(job.CreatedBy || "")))
      .map((job) => String(job._id))
  );
  const summary = {
    activeRecruiters: recruiters.length,
    activeRequirementsAssigned: recruiterRows.reduce((sum, row) => sum + row.activeRequirements, 0),
    totalUploadsAcrossActiveRequirements: recruiterRows.reduce((sum, row) => sum + row.totalUploadsActiveRequirements, 0),
    todaysUploads: recruiterRows.reduce((sum, row) => sum + row.todaysUploads, 0),
    statusTotals,
    jobsCreatedToday: mentorRows.reduce((sum, row) => sum + row.jobsCreatedToday, 0),
    activeRequirements: mentorActiveJobIdSet.size,
    activeOpenings: Math.max(
      0,
      activeJobs
        .filter((job) => mentorActiveJobIdSet.has(String(job._id)))
        .reduce((sum, job) => sum + (Number(job.noOfPositions) || 0), 0) -
      candidates.filter((candidate) => (
        mentorActiveJobIdSet.has(String(candidate.jobId?._id || candidate.jobId)) &&
        normalizeStatus(candidate.status) === "Joined"
      )).length
    ),
    totalJoinedToday,
  };

  return {
    period,
    statusColumns: buildStatusColumns(statusTotals),
    recruiterRows,
    mentorRows,
    summary,
  };
};

const buildHtmlReport = (data) => {
  const { period, summary, recruiterRows, mentorRows, statusColumns } = data;
  const summaryCards = [
    ["Overall Active Recruiters", summary.activeRecruiters],
    ["Overall Active Requirements Assigned", summary.activeRequirementsAssigned],
    ["Overall Total Uploads", summary.totalUploadsAcrossActiveRequirements],
    ["Today's Uploads", summary.todaysUploads],
    ["Jobs Created Today", summary.jobsCreatedToday],
    ["Overall Active Requirements", summary.activeRequirements],
    ["Overall Active Openings", summary.activeOpenings],
    ["Joined Today", summary.totalJoinedToday],
  ];

  const buildCardRows = (cards, columns = 4) => {
    const rows = [];
    for (let index = 0; index < cards.length; index += columns) {
      rows.push(cards.slice(index, index + columns));
    }

    return rows.map((row) => `
      <tr>
        ${row.map(([label, value]) => `
          <td class="stack-column" width="${Math.floor(100 / columns)}%" style="padding:6px;vertical-align:top;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
              <tr>
                <td style="padding:14px;">
                  <div style="font-size:12px;line-height:16px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.02em;">${escapeHtml(label)}</div>
                  <div style="font-size:24px;line-height:30px;font-weight:800;color:#0f172a;margin-top:4px;">${value}</div>
                </td>
              </tr>
            </table>
          </td>
        `).join("")}
      </tr>
    `).join("");
  };

  const statusCards = statusColumns.map((status) => [status, summary.statusTotals[status] || 0]);

  const recruiterHeader = statusColumns.map((status) => `<th style="padding:9px 8px;border:1px solid #dbe3ef;text-align:right;white-space:nowrap;">${escapeHtml(status)}</th>`).join("");
  const recruiterRowsHtml = recruiterRows.map((row) => `
    <tr>
      <td style="padding:9px 8px;border:1px solid #e5e7eb;font-weight:700;color:#0f172a;white-space:nowrap;">${escapeHtml(row.recruiterName)}</td>
      <td style="padding:9px 8px;border:1px solid #e5e7eb;text-align:right;">${row.activeRequirements}</td>
      <td style="padding:9px 8px;border:1px solid #e5e7eb;text-align:right;">${row.totalUploadsActiveRequirements}</td>
      <td style="padding:9px 8px;border:1px solid #e5e7eb;text-align:right;font-weight:700;color:#1d4ed8;">${row.todaysUploads}</td>
      ${statusColumns.map((status) => `<td style="padding:9px 8px;border:1px solid #e5e7eb;text-align:right;">${row.statusCounts[status] || 0}</td>`).join("")}
    </tr>
  `).join("");

  const mentorRowsHtml = mentorRows.map((row) => `
    <tr>
      <td style="padding:10px;border:1px solid #e5e7eb;font-weight:700;color:#0f172a;">${escapeHtml(row.mentorName)}</td>
      <td style="padding:10px;border:1px solid #e5e7eb;text-align:right;">${row.jobsCreatedToday}</td>
      <td style="padding:10px;border:1px solid #e5e7eb;text-align:right;">${row.activeRequirementsNow}</td>
      <td style="padding:10px;border:1px solid #e5e7eb;text-align:right;">${row.activeOpeningsNow}</td>
    </tr>
  `).join("");

  const joiningRows = recruiterRows.flatMap((row) => (
    row.joinedToday.length
      ? row.joinedToday.map((joining) => `
        <tr>
          <td style="padding:10px;border:1px solid #e5e7eb;">${escapeHtml(row.recruiterName)}</td>
          <td style="padding:10px;border:1px solid #e5e7eb;">${escapeHtml(joining.candidateName)}</td>
          <td style="padding:10px;border:1px solid #e5e7eb;">${escapeHtml(joining.jobTitle)}</td>
          <td style="padding:10px;border:1px solid #e5e7eb;">${escapeHtml(joining.joiningTime)}</td>
        </tr>
      `)
      : []
  )).join("");

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          @media only screen and (max-width: 640px) {
            .email-shell { width: 100% !important; }
            .email-pad { padding: 14px !important; }
            .header-title { font-size: 20px !important; line-height: 26px !important; }
            .stack-column { display: block !important; width: 100% !important; box-sizing: border-box !important; }
            .table-scroll { overflow-x: auto !important; -webkit-overflow-scrolling: touch !important; }
            .section-title { font-size: 18px !important; }
          }
        </style>
      </head>
      <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f1f5f9;">
          <tr>
            <td align="center" style="padding:18px 10px;">
              <table class="email-shell" role="presentation" width="1100" cellpadding="0" cellspacing="0" style="width:1100px;max-width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                <tr>
                  <td style="background:#0f172a;padding:24px;color:#ffffff;">
                    <h1 class="header-title" style="margin:0;font-size:24px;line-height:32px;font-weight:800;color:#ffffff;">${escapeHtml(period.title)}</h1>
                    <p style="margin:8px 0 0;color:#cbd5e1;font-size:14px;line-height:20px;">Date: ${escapeHtml(period.dateDisplay)} &nbsp;|&nbsp; Period: ${formatTime(period.start, period.timezone)} - ${formatTime(period.end, period.timezone)}</p>
                  </td>
                </tr>
                <tr>
                  <td class="email-pad" style="padding:24px;">
                    <h2 class="section-title" style="margin:0 0 14px;font-size:20px;line-height:26px;color:#0f172a;">CEO Summary</h2>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
                      ${buildCardRows(summaryCards, 4)}
                    </table>

                    <h3 class="section-title" style="margin:8px 0 14px;font-size:18px;line-height:24px;color:#0f172a;">Candidate Status Changes Today</h3>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px;">
                      ${buildCardRows(statusCards, 4)}
                    </table>

                    <h2 class="section-title" style="margin:0 0 12px;font-size:20px;line-height:26px;color:#0f172a;">Recruiter Report</h2>
                    <div class="table-scroll" style="width:100%;overflow-x:auto;">
              <table style="width:100%;min-width:980px;border-collapse:collapse;font-size:12px;line-height:18px;">
                <thead><tr style="background:#1e3a8a;color:#fff;">
                  <th style="padding:9px 8px;border:1px solid #dbe3ef;text-align:left;white-space:nowrap;">Recruiter</th>
                  <th style="padding:9px 8px;border:1px solid #dbe3ef;text-align:right;white-space:nowrap;">Overall Active Req.</th>
                  <th style="padding:9px 8px;border:1px solid #dbe3ef;text-align:right;white-space:nowrap;">Overall Total Uploads</th>
                  <th style="padding:9px 8px;border:1px solid #dbe3ef;text-align:right;white-space:nowrap;">Today Uploads</th>
                  ${recruiterHeader}
                </tr></thead>
                <tbody>${recruiterRowsHtml || `<tr><td colspan="${4 + statusColumns.length}" style="padding:16px;text-align:center;">No active recruiters found.</td></tr>`}</tbody>
              </table>
            </div>
            <h2 class="section-title" style="margin:28px 0 12px;font-size:20px;line-height:26px;color:#0f172a;">Mentor Report</h2>
            <div class="table-scroll" style="width:100%;overflow-x:auto;">
              <table style="width:100%;min-width:620px;border-collapse:collapse;font-size:13px;line-height:19px;">
                <thead><tr style="background:#0f766e;color:#fff;">
                  <th style="padding:10px;border:1px solid #dbe3ef;text-align:left;">Mentor</th>
                  <th style="padding:10px;border:1px solid #dbe3ef;text-align:right;">Jobs Created Today</th>
                  <th style="padding:10px;border:1px solid #dbe3ef;text-align:right;">Overall Active Requirements</th>
                  <th style="padding:10px;border:1px solid #dbe3ef;text-align:right;">Overall Active Openings</th>
                </tr></thead>
                <tbody>${mentorRowsHtml || `<tr><td colspan="4" style="padding:16px;text-align:center;">No active mentors found.</td></tr>`}</tbody>
              </table>
            </div>
            <h2 class="section-title" style="margin:28px 0 12px;font-size:20px;line-height:26px;color:#0f172a;">Today's Joining</h2>
            ${joiningRows ? `
              <div class="table-scroll" style="width:100%;overflow-x:auto;"><table style="width:100%;min-width:620px;border-collapse:collapse;font-size:13px;line-height:19px;">
                <thead><tr style="background:#f8fafc;">
                  <th style="padding:10px;border:1px solid #e5e7eb;text-align:left;">Recruiter</th>
                  <th style="padding:10px;border:1px solid #e5e7eb;text-align:left;">Candidate</th>
                  <th style="padding:10px;border:1px solid #e5e7eb;text-align:left;">Requirement</th>
                  <th style="padding:10px;border:1px solid #e5e7eb;text-align:left;">Joining Time</th>
                </tr></thead><tbody>${joiningRows}</tbody>
              </table></div>
            ` : `<p style="padding:14px;background:#f8fafc;border-radius:8px;">No joining today</p>`}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
};

const drawKeyValueGrid = (doc, items, columns = 4) => {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gap = 8;
  const cardWidth = (pageWidth - gap * (columns - 1)) / columns;
  const cardHeight = 52;
  let x = doc.page.margins.left;
  let y = doc.y;

  items.forEach(([label, value], index) => {
    if (index > 0 && index % columns === 0) {
      x = doc.page.margins.left;
      y += cardHeight + gap;
    }
    if (y + cardHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.y;
      x = doc.page.margins.left;
    }

    doc
      .roundedRect(x, y, cardWidth, cardHeight, 6)
      .fillAndStroke("#f8fafc", "#e2e8f0");
    doc
      .fillColor("#64748b")
      .fontSize(7)
      .font("Helvetica-Bold")
      .text(String(label).toUpperCase(), x + 8, y + 8, { width: cardWidth - 16 });
    doc
      .fillColor("#0f172a")
      .fontSize(17)
      .font("Helvetica-Bold")
      .text(String(value), x + 8, y + 25, { width: cardWidth - 16 });

    x += cardWidth + gap;
  });

  doc.y = y + cardHeight + 18;
};

const drawTable = (doc, headers, rows, columnWidths, options = {}) => {
  const rowHeight = options.rowHeight || 24;
  const headerHeight = options.headerHeight || 28;
  const startX = doc.page.margins.left;
  const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);

  const drawHeader = () => {
    if (doc.y + headerHeight > doc.page.height - doc.page.margins.bottom) doc.addPage();
    let x = startX;
    const y = doc.y;
    doc.rect(startX, y, tableWidth, headerHeight).fill(options.headerColor || "#1e3a8a");
    headers.forEach((header, index) => {
      doc
        .fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(7)
        .text(header, x + 4, y + 8, {
          width: columnWidths[index] - 8,
          align: index === 0 ? "left" : "right",
        });
      x += columnWidths[index];
    });
    doc.y = y + headerHeight;
  };

  drawHeader();
  rows.forEach((row, rowIndex) => {
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    let x = startX;
    doc.rect(startX, y, tableWidth, rowHeight).fill(rowIndex % 2 === 0 ? "#ffffff" : "#f8fafc");
    row.forEach((cell, index) => {
      doc
        .fillColor("#0f172a")
        .font(index === 0 ? "Helvetica-Bold" : "Helvetica")
        .fontSize(7)
        .text(String(cell ?? ""), x + 4, y + 7, {
          width: columnWidths[index] - 8,
          align: index === 0 ? "left" : "right",
          ellipsis: true,
        });
      x += columnWidths[index];
    });
    doc.y = y + rowHeight;
  });
  doc.y += 14;
};

const buildPdfReportBuffer = (data) => new Promise((resolve, reject) => {
  const report = data || {};
  const period = report.period || {};
  const summary = {
    activeRecruiters: 0,
    activeRequirementsAssigned: 0,
    totalUploadsAcrossActiveRequirements: 0,
    todaysUploads: 0,
    jobsCreatedToday: 0,
    activeRequirements: 0,
    activeOpenings: 0,
    totalJoinedToday: 0,
    ...(report.summary || {}),
  };
  summary.statusTotals = summary.statusTotals || {};
  const recruiterRows = Array.isArray(report.recruiterRows) ? report.recruiterRows : [];
  const mentorRows = Array.isArray(report.mentorRows) ? report.mentorRows : [];
  const statusColumns = Array.isArray(report.statusColumns) && report.statusColumns.length
    ? report.statusColumns
    : BASE_STATUS_COLUMNS;
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 28 });
  const chunks = [];

  doc.on("data", (chunk) => chunks.push(chunk));
  doc.on("end", () => resolve(Buffer.concat(chunks)));
  doc.on("error", reject);

  doc.rect(0, 0, doc.page.width, 86).fill("#0f172a");
  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(20)
    .text(period.title || "ATS Daily Performance Report", 28, 24);
  doc
    .fillColor("#cbd5e1")
    .font("Helvetica")
    .fontSize(10)
    .text(`Date: ${period.dateDisplay || "-"} | Period: ${period.start && period.end ? `${formatTime(period.start, period.timezone)} - ${formatTime(period.end, period.timezone)}` : "-"}`, 28, 52);

  doc.y = 106;
  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(14).text("CEO Summary");
  doc.moveDown(0.6);
  drawKeyValueGrid(doc, [
    ["Overall Active Recruiters", summary.activeRecruiters],
    ["Overall Active Requirements Assigned", summary.activeRequirementsAssigned],
    ["Overall Total Uploads", summary.totalUploadsAcrossActiveRequirements],
    ["Today's Uploads", summary.todaysUploads],
    ["Jobs Created Today", summary.jobsCreatedToday],
    ["Overall Active Requirements", summary.activeRequirements],
    ["Overall Active Openings", summary.activeOpenings],
    ["Joined Today", summary.totalJoinedToday],
  ], 4);

  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(13).text("Candidate Status Changes Today");
  doc.moveDown(0.6);
  drawKeyValueGrid(doc, statusColumns.map((status) => [status, summary.statusTotals[status] || 0]), 4);

  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(13).text("Recruiter Report");
  doc.moveDown(0.5);
  const recruiterHeaders = ["Recruiter", "Overall Active Req.", "Overall Total Uploads", "Today Uploads", ...statusColumns];
  const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const firstColumns = [92, 50, 58, 58];
  const statusWidth = Math.max(38, (availableWidth - firstColumns.reduce((sum, width) => sum + width, 0)) / Math.max(statusColumns.length, 1));
  drawTable(
    doc,
    recruiterHeaders,
    recruiterRows.map((row) => [
      row.recruiterName,
      row.activeRequirements,
      row.totalUploadsActiveRequirements,
      row.todaysUploads,
      ...statusColumns.map((status) => (row.statusCounts || {})[status] || 0),
    ]),
    [...firstColumns, ...statusColumns.map(() => statusWidth)],
    { headerColor: "#1e3a8a", rowHeight: 23 }
  );

  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(13).text("Mentor Report");
  doc.moveDown(0.5);
  drawTable(
    doc,
    ["Mentor", "Jobs Created Today", "Overall Active Requirements", "Overall Active Openings"],
    mentorRows.map((row) => [row.mentorName, row.jobsCreatedToday, row.activeRequirementsNow, row.activeOpeningsNow]),
    [180, 120, 140, 130],
    { headerColor: "#0f766e", rowHeight: 24 }
  );

  const joiningRows = recruiterRows.flatMap((row) => (row.joinedToday || []).map((joining) => [
    row.recruiterName,
    joining.candidateName,
    joining.jobTitle,
    joining.joiningTime,
  ]));

  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(13).text("Today's Joining");
  doc.moveDown(0.5);
  if (joiningRows.length) {
    drawTable(doc, ["Recruiter", "Candidate", "Requirement", "Joining Time"], joiningRows, [160, 180, 210, 100], {
      headerColor: "#334155",
      rowHeight: 24,
    });
  } else {
    doc.fillColor("#64748b").font("Helvetica").fontSize(10).text("No joining today");
  }

  doc.end();
});

const sendCeoDailyReport = async ({ slot = "12PM", force = false, test = false, triggeredBy, referenceDate = new Date() } = {}) => {
  const settings = await getSettings();
  const timezone = settings.timezone || DEFAULT_TIMEZONE;
  const enabled = slot === "7PM" ? settings.enable7PmReport : settings.enable12PmReport;

  if (!enabled && !force && !test) {
    return { skipped: true, reason: `${slot} report is disabled.` };
  }

  if (!test && !force && !isWorkingDay(referenceDate, timezone)) {
    return { skipped: true, reason: "Today is not a working day." };
  }

  const data = await generateCeoDailyReportData({ slot, referenceDate, timezone });
  const subject = `ATS Daily Performance Report - ${data.period.dateDisplay} - ${data.period.reportLabel}`;
  const html = buildHtmlReport(data);

  const existingSent = await CeoDailyReportLog.findOne({
    reportType: REPORT_TYPE,
    reportDate: data.period.reportDate,
    reportSlot: slot,
    emailStatus: "sent",
  });

  if (existingSent && !force && !test) {
    return { skipped: true, reason: `${slot} report already sent for ${data.period.reportDate}.`, log: existingSent };
  }

  const recipients = normalizeList(settings.emailRecipients.length ? settings.emailRecipients : process.env.CEO_DAILY_REPORT_RECIPIENTS);
  const ccRecipients = normalizeList(settings.ccRecipients);

  const log = new CeoDailyReportLog({
    reportDate: data.period.reportDate,
    reportSlot: slot,
    generatedAt: new Date(),
    periodStart: data.period.start,
    periodEnd: data.period.end,
    timezone,
    recipients,
    ccRecipients,
    subject,
    html,
    summary: data.summary,
    reportData: data,
    triggeredBy,
    emailStatus: recipients.length ? "pending" : "not_configured",
  });

  if (recipients.length) {
    try {
      await sendMail({
        fromName: "Jobs Territory ATS Reports",
        to: recipients,
        cc: ccRecipients,
        subject,
        html,
        provider: process.env.CEO_DAILY_REPORT_EMAIL_PROVIDER || "smtp",
      });
      log.emailStatus = "sent";
    } catch (error) {
      log.emailStatus = "failed";
      log.emailError = JSON.stringify(formatEmailErrorResponse(error));
    }
  }

  log.status = log.emailStatus === "sent" ? "success" : "failed";

  let savedLog = log;
  try {
    await log.save();
  } catch (error) {
    const isDuplicateSentLog = error?.code === 11000 && log.emailStatus === "sent";
    if (!isDuplicateSentLog) {
      throw error;
    }

    const replacement = log.toObject();
    delete replacement._id;
    delete replacement.__v;
    delete replacement.createdAt;
    replacement.updatedAt = new Date();

    savedLog = await CeoDailyReportLog.findOneAndUpdate(
      {
        reportType: REPORT_TYPE,
        reportDate: log.reportDate,
        reportSlot: log.reportSlot,
        emailStatus: "sent",
      },
      { $set: replacement },
      { new: true }
    );
  }

  return {
    skipped: false,
    log: savedLog,
    data,
    delivery: {
      status: savedLog.status,
      emailStatus: savedLog.emailStatus,
      emailError: savedLog.emailError,
      recipients,
      ccRecipients,
    },
  };
};

module.exports = {
  getSettings,
  updateSettings,
  getDailyReportPeriod,
  generateCeoDailyReportData,
  buildHtmlReport,
  buildPdfReportBuffer,
  sendCeoDailyReport,
};
