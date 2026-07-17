const express = require("express");
const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const User = require("../models/Users");
const { protect } = require("../middleware/authMiddleware");
const { sendMail, formatEmailErrorResponse } = require("../services/emailService");

const router = express.Router();

const isValidDateInput = (value) => {
    if (!value || typeof value !== "string") return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime());
};

// 📋 Get attendance report with filters
router.get("/report", async (req, res) => {
    try {
        const { startDate, endDate, userId, designation } = req.query;

        if (startDate && !isValidDateInput(startDate)) {
            return res.status(400).json({
                success: false,
                message: "Invalid startDate. Please use a valid date value.",
            });
        }

        if (endDate && !isValidDateInput(endDate)) {
            return res.status(400).json({
                success: false,
                message: "Invalid endDate. Please use a valid date value.",
            });
        }

        if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid userId.",
            });
        }

        const userQuery = {
            designation: { $ne: "Admin" },
        };

        if (designation) {
            userQuery.designation = { $eq: designation, $ne: "Admin" };
        }

        const eligibleUsers = await User.find(userQuery).select("_id");
        const eligibleUserIds = eligibleUsers.map((user) => user._id);

        if (userId) {
            const isEligibleUser = eligibleUserIds.some((eligibleUserId) => eligibleUserId.toString() === userId);
            if (!isEligibleUser) {
                return res.status(200).json({
                    success: true,
                    count: 0,
                    data: [],
                });
            }
        }

        let query = { user: userId || { $in: eligibleUserIds } };

        // Filter by date range
        if (startDate || endDate) {
            query.date = {};
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                query.date.$gte = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.date.$lte = end;
            }
        }

        const attendanceRecords = await Attendance.find(query)
            .sort({ date: -1 })
            .populate("user", "name email designation profilePhoto");

        res.status(200).json({
            success: true,
            count: attendanceRecords.length,
            data: attendanceRecords,
        });
    } catch (error) {
        console.error("Error fetching attendance report:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// 📧 Send email report with filters
router.post("/send-report-email", protect, async (req, res) => {
    try {
        // 1. Authenticate and check role-based access
        if (!req.user || (req.user.designation !== "Admin" && req.user.designation !== "Finance")) {
            return res.status(403).json({
                success: false,
                message: "Forbidden: You do not have permission to perform this action.",
            });
        }

        // 2. Validate receiver details
        const { receiverName, receiverEmail, subject, startDate, endDate, role, userIds, filters } = req.body;

        if (!receiverEmail) {
            return res.status(400).json({
                success: false,
                message: "Receiver email is required.",
            });
        }

        // Basic email regex validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(receiverEmail)) {
            return res.status(400).json({
                success: false,
                message: "Please provide a valid receiver email address.",
            });
        }

        // Validate date ranges if provided
        if (startDate && !isValidDateInput(startDate)) {
            return res.status(400).json({
                success: false,
                message: "Invalid startDate.",
            });
        }
        if (endDate && !isValidDateInput(endDate)) {
            return res.status(400).json({
                success: false,
                message: "Invalid endDate.",
            });
        }

        // 3. Re-query the attendance records using supplied filters
        const userQuery = {
            designation: { $ne: "Admin" },
        };

        if (role && role !== "all") {
            userQuery.designation = { $eq: role, $ne: "Admin" };
        }

        if (userIds && userIds.length > 0) {
            userQuery._id = { $in: userIds.map(id => new mongoose.Types.ObjectId(id)) };
        }

        const eligibleUsers = await User.find(userQuery).select("_id name email designation");
        const eligibleUserIds = eligibleUsers.map((user) => user._id);

        const query = { user: { $in: eligibleUserIds } };

        if (startDate || endDate) {
            query.date = {};
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                query.date.$gte = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.date.$lte = end;
            }
        }

        const attendanceRecords = await Attendance.find(query)
            .sort({ date: 1 }) // sort date ascending so we can calculate chronologically
            .populate("user", "name email designation profilePhoto");

        // 4. Apply extra filters (searchTerm, statusFilter)
        let filteredRecords = [...attendanceRecords];
        if (filters) {
            const { searchTerm, statusFilter } = filters;
            if (searchTerm) {
                const normalizedSearch = searchTerm.trim().toLowerCase();
                filteredRecords = filteredRecords.filter(
                    (record) =>
                        record.user && (
                            record.user.name.toLowerCase().includes(normalizedSearch) ||
                            record.user.email.toLowerCase().includes(normalizedSearch) ||
                            record.user.designation.toLowerCase().includes(normalizedSearch)
                        )
                );
            }
            if (statusFilter) {
                filteredRecords = filteredRecords.filter((record) => record.status === statusFilter);
            }
        }

        let summaryRecords = [...attendanceRecords];
        if (filters && filters.searchTerm) {
            const normalizedSearch = filters.searchTerm.trim().toLowerCase();
            summaryRecords = summaryRecords.filter(
                (record) =>
                    record.user && (
                        record.user.name.toLowerCase().includes(normalizedSearch) ||
                        record.user.email.toLowerCase().includes(normalizedSearch) ||
                        record.user.designation.toLowerCase().includes(normalizedSearch)
                    )
            );
        }

        // 5. Calculate calculations
        // Helper functions
        const formatMinutes = (min) => {
            const safeMinutes = Math.max(0, Number(min) || 0);
            const hours = Math.floor(safeMinutes / 60);
            const remainingMinutes = safeMinutes % 60;
            return `${hours}h ${String(remainingMinutes).padStart(2, "0")}m`;
        };

        const parseTimeToMinutes = (timeStr) => {
            if (!timeStr) return 0;
            const parts = timeStr.split(':');
            if (parts.length >= 2) {
                const hours = parseInt(parts[0], 10) || 0;
                const minutes = parseInt(parts[1], 10) || 0;
                return hours * 60 + minutes;
            }
            return 0;
        };

        const isLate = (firstLoginTime) => {
            if (!firstLoginTime) return false;
            const parts = firstLoginTime.split(':');
            if (parts.length >= 2) {
                const hours = parseInt(parts[0], 10);
                const minutes = parseInt(parts[1], 10);
                if (hours > 9 || (hours === 9 && minutes > 30)) {
                    return true;
                }
            }
            return false;
        };

        const getDateOnly = (dateValue) => {
            const date = new Date(dateValue);
            if (Number.isNaN(date.getTime())) return null;
            return new Date(date.getFullYear(), date.getMonth(), date.getDate());
        };

        const getInputDateOnly = (dateValue) => {
            if (!dateValue) return null;
            const [year, month, day] = String(dateValue).split("-").map(Number);
            if (!year || !month || !day) return getDateOnly(dateValue);
            return new Date(year, month - 1, day);
        };

        const isSunday = (dateValue) => {
            const date = getDateOnly(dateValue);
            return date ? date.getDay() === 0 : false;
        };

        const countWorkingDaysExcludingSundays = (start, end) => {
            if (!start || !end || start > end) return 0;
            let workingDays = 0;
            const cursor = new Date(start);
            while (cursor <= end) {
                if (cursor.getDay() !== 0) {
                    workingDays++;
                }
                cursor.setDate(cursor.getDate() + 1);
            }
            return workingDays;
        };

        // Group by user
        const userRecordsMap = {};
        filteredRecords.forEach(record => {
            if (!record.user) return;
            const userIdStr = record.user._id.toString();
            if (!userRecordsMap[userIdStr]) {
                userRecordsMap[userIdStr] = {
                    user: record.user,
                    records: []
                };
            }
            userRecordsMap[userIdStr].records.push(record);
        });

        const summaryUserRecordsMap = {};
        summaryRecords.forEach(record => {
            if (!record.user) return;
            const userIdStr = record.user._id.toString();
            if (!summaryUserRecordsMap[userIdStr]) {
                summaryUserRecordsMap[userIdStr] = {
                    user: record.user,
                    records: []
                };
            }
            summaryUserRecordsMap[userIdStr].records.push(record);
        });

        const sortedSummaryRecords = [...summaryRecords].sort((a, b) => new Date(a.date) - new Date(b.date));
        const periodStartDate = startDate
            ? getInputDateOnly(startDate)
            : sortedSummaryRecords.length > 0
                ? getDateOnly(sortedSummaryRecords[0].date)
                : null;
        const periodEndDate = endDate
            ? getInputDateOnly(endDate)
            : sortedSummaryRecords.length > 0
                ? getDateOnly(sortedSummaryRecords[sortedSummaryRecords.length - 1].date)
                : null;
        const totalWorkingDaysInPeriod = countWorkingDaysExcludingSundays(periodStartDate, periodEndDate);

        let summaryUsers = [...eligibleUsers];
        if (filters && filters.searchTerm) {
            const normalizedSearch = filters.searchTerm.trim().toLowerCase();
            summaryUsers = summaryUsers.filter((user) =>
                user.name.toLowerCase().includes(normalizedSearch) ||
                user.email.toLowerCase().includes(normalizedSearch) ||
                user.designation.toLowerCase().includes(normalizedSearch)
            );
        }

        // Compute employee summaries
        const employeeSummaries = summaryUsers.map((user) => {
            const records = summaryUserRecordsMap[user._id.toString()]?.records || [];
            const nonSundayRecords = records.filter((record) => !isSunday(record.date));
            const workingDays = totalWorkingDaysInPeriod;
            let presentDays = 0;
            let halfDays = 0;
            let lateDays = 0;
            let totalLoginSessions = 0;
            let totalWorkedMinutes = 0;

            nonSundayRecords.forEach(record => {
                if (record.status === "Present") {
                    presentDays++;
                } else if (record.status === "Half Day") {
                    halfDays++;
                }

                totalLoginSessions += record.sessions ? record.sessions.length : 0;

                // Sum completed sessions duration
                let dayMinutes = 0;
                if (record.sessions && record.sessions.length > 0) {
                    record.sessions.forEach(session => {
                        if (session.loginTime && session.logoutTime && !session.isActive) {
                            const loginMin = parseTimeToMinutes(session.loginTime);
                            const logoutMin = parseTimeToMinutes(session.logoutTime);
                            if (logoutMin > loginMin) {
                                dayMinutes += (logoutMin - loginMin);
                            }
                        }
                    });
                }
                totalWorkedMinutes += dayMinutes;

                if (isLate(record.firstLogin)) {
                    lateDays++;
                }
            });

            const totalDaysWorked = presentDays + halfDays;
            const absentDays = Math.max(0, totalWorkingDaysInPeriod - presentDays - halfDays);
            const averageMinutesPerPresentDay = totalDaysWorked > 0
                ? Math.round(totalWorkedMinutes / totalDaysWorked)
                : 0;

            return {
                user,
                records,
                workingDays,
                totalDaysWorked,
                presentDays,
                absentDays,
                halfDays,
                lateDays,
                totalLoginSessions,
                totalWorkedMinutes,
                averageMinutesPerPresentDay
            };
        });

        // Calculate Overall Statistics
        const totalEmployees = eligibleUsers.length;
        const employeesWithAttendance = Object.keys(userRecordsMap).length;

        const totalWorkingDays = totalWorkingDaysInPeriod;

        // Total Working Hours
        const overallTotalMinutes = employeeSummaries.reduce((sum, emp) => sum + emp.totalWorkedMinutes, 0);

        // Average Attendance
        let totalEmployeePresentDays = 0;
        let totalEmployeeWorkingDays = 0;
        employeeSummaries.forEach(emp => {
            totalEmployeePresentDays += emp.presentDays + (emp.halfDays * 0.5);
            totalEmployeeWorkingDays += emp.workingDays;
        });
        const averageAttendance = totalEmployeeWorkingDays > 0
            ? Math.round((totalEmployeePresentDays / totalEmployeeWorkingDays) * 100)
            : 0;

        // Format dates for reporting period
        const formatDateReport = (dateStr) => {
            if (!dateStr) return "";
            const date = new Date(dateStr);
            const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const day = String(date.getDate()).padStart(2, '0');
            const month = months[date.getMonth()];
            const year = date.getFullYear();
            return `${day} ${month} ${year}`;
        };

        let reportingPeriodStr = "N/A";
        if (startDate && endDate) {
            reportingPeriodStr = `${formatDateReport(startDate)} – ${formatDateReport(endDate)}`;
        } else if (filteredRecords.length > 0) {
            // Sort records temporarily to find min and max date
            const sortedTemp = [...filteredRecords].sort((a, b) => new Date(a.date) - new Date(b.date));
            reportingPeriodStr = `${formatDateReport(sortedTemp[0].date)} – ${formatDateReport(sortedTemp[sortedTemp.length - 1].date)}`;
        }

        // 6. Generate Responsive HTML Email with Inline CSS
        const overallSummaryHtml = `
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px; font-family: sans-serif;">
                <thead>
                    <tr style="background-color: #1e3a8a; color: #ffffff;">
                        <th style="padding: 10px; border: 1px solid #ddd; text-align: left; font-size: 14px;">Metric</th>
                        <th style="padding: 10px; border: 1px solid #ddd; text-align: left; font-size: 14px;">Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px; font-weight: bold; background-color: #f8fafc;">Reporting Period</td>
                        <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px;">${reportingPeriodStr}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px; font-weight: bold; background-color: #f8fafc;">Total Employees</td>
                        <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px;">${totalEmployees}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px; font-weight: bold; background-color: #f8fafc;">Employees with Attendance</td>
                        <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px;">${employeesWithAttendance}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px; font-weight: bold; background-color: #f8fafc;">Scheduled Workdays</td>
                        <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px;">${totalWorkingDays}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px; font-weight: bold; background-color: #f8fafc;">Average Attendance</td>
                        <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px; font-weight: bold; color: #16a34a;">${averageAttendance}%</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px; font-weight: bold; background-color: #f8fafc;">Total Working Hours</td>
                        <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px; font-weight: bold;">${overallTotalMinutes > 0 ? (Math.floor(overallTotalMinutes / 60)).toLocaleString() + " hrs" : "0 hrs"}</td>
                    </tr>
                </tbody>
            </table>
        `;

        let employeeRowsHtml = "";
        employeeSummaries.forEach(emp => {
            employeeRowsHtml += `
                <tr style="hover: background-color: #f1f5f9;">
                    <td style="padding: 10px; border: 1px solid #ddd; font-size: 13px; font-weight: bold; color: #1e293b;">${emp.user.name}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; font-size: 13px; color: #475569;">${emp.user.designation}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; font-size: 13px; text-align: center; color: #475569;">${emp.workingDays}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; font-size: 13px; text-align: center; font-weight: bold; color: #1e293b;">${emp.totalDaysWorked}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; font-size: 13px; text-align: center; font-weight: bold; color: #16a34a;">${emp.presentDays}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; font-size: 13px; text-align: center; font-weight: bold; color: #2563eb;">${emp.halfDays}</td>
                    <td style="padding: 10px; border: 1px solid #ddd; font-size: 13px; text-align: center; font-weight: bold; color: #dc2626;">${emp.absentDays}</td>
                </tr>
            `;
        });

        const employeeSummaryTableHtml = `
            <div style="overflow-x: auto; margin-bottom: 30px;">
                <table style="width: 100%; border-collapse: collapse; font-family: sans-serif; min-width: 600px;">
                    <thead>
                        <tr style="background-color: #1e3a8a; color: #ffffff;">
                            <th style="padding: 10px; border: 1px solid #ddd; text-align: left; font-size: 13px;">Employee</th>
                            <th style="padding: 10px; border: 1px solid #ddd; text-align: left; font-size: 13px;">Role</th>
                            <th style="padding: 10px; border: 1px solid #ddd; text-align: right; font-size: 13px;">Scheduled Workdays</th>
                            <th style="padding: 10px; border: 1px solid #ddd; text-align: right; font-size: 13px;">Attended Days</th>
                            <th style="padding: 10px; border: 1px solid #ddd; text-align: right; font-size: 13px;">Present Days</th>
                            <th style="padding: 10px; border: 1px solid #ddd; text-align: right; font-size: 13px;">Half Days</th>
                            <th style="padding: 10px; border: 1px solid #ddd; text-align: right; font-size: 13px;">Absent Days</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${employeeRowsHtml || `<tr><td colspan="7" style="padding: 15px; text-align: center; color: #64748b;">No employee summaries available.</td></tr>`}
                    </tbody>
                </table>
            </div>
        `;

        // Detailed User-wise Section
        let detailedUserWiseHtml = "";
        employeeSummaries.forEach(emp => {
            let dailyRowsHtml = "";
            emp.records.forEach(rec => {
                const formattedDate = formatDateReport(rec.date);
                const firstLoginTime = rec.firstLogin ? rec.firstLogin : "-";
                const lastLogoutTime = rec.lastLogout ? rec.lastLogout : (rec.sessions.some(s => s.isActive) ? "Active" : "-");
                const sessionsCount = rec.sessions ? rec.sessions.length : 0;
                
                // Sum completed sessions duration
                let dayMinutes = 0;
                if (rec.sessions && rec.sessions.length > 0) {
                    rec.sessions.forEach(session => {
                        if (session.loginTime && session.logoutTime && !session.isActive) {
                            const loginMin = parseTimeToMinutes(session.loginTime);
                            const logoutMin = parseTimeToMinutes(session.logoutTime);
                            if (logoutMin > loginMin) {
                                dayMinutes += (logoutMin - loginMin);
                            }
                        }
                    });
                }

                const dayHours = formatMinutes(dayMinutes);
                const isDayLate = isLate(rec.firstLogin);
                const isHalfDay = rec.status === "Half Day";

                dailyRowsHtml += `
                    <tr>
                        <td style="padding: 8px; border: 1px solid #e2e8f0; font-size: 12px; color: #1e293b;">${formattedDate}</td>
                        <td style="padding: 8px; border: 1px solid #e2e8f0; font-size: 12px; text-align: center; color: #475569;">${firstLoginTime}</td>
                        <td style="padding: 8px; border: 1px solid #e2e8f0; font-size: 12px; text-align: center; color: #475569;">${lastLogoutTime}</td>
                        <td style="padding: 8px; border: 1px solid #e2e8f0; font-size: 12px; text-align: center; color: #475569;">${sessionsCount}</td>
                        <td style="padding: 8px; border: 1px solid #e2e8f0; font-size: 12px; text-align: right; font-weight: bold; color: #1e293b;">${dayHours}</td>
                        <td style="padding: 8px; border: 1px solid #e2e8f0; font-size: 12px; text-align: center;">
                            <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; 
                                ${rec.status === 'Present' ? 'background-color: #dcfce7; color: #15803d;' : 
                                  rec.status === 'Half Day' ? 'background-color: #fef9c3; color: #a16207;' : 
                                  rec.status === 'Leave' ? 'background-color: #dbeafe; color: #1d4ed8;' : 
                                  'background-color: #fee2e2; color: #b91c1c;'}">
                                ${rec.status}
                            </span>
                        </td>
                        <td style="padding: 8px; border: 1px solid #e2e8f0; font-size: 12px; text-align: center; color: ${isDayLate ? '#d97706; font-weight: bold;' : '#64748b;'}">
                            ${isDayLate ? "Yes" : "No"}
                        </td>
                        <td style="padding: 8px; border: 1px solid #e2e8f0; font-size: 12px; text-align: center; color: ${isHalfDay ? '#2563eb; font-weight: bold;' : '#64748b;'}">
                            ${isHalfDay ? "Yes" : "No"}
                        </td>
                    </tr>
                `;
            });

            detailedUserWiseHtml += `
                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 15px; margin-bottom: 20px; font-family: sans-serif;">
                    <div style="margin-bottom: 12px; border-bottom: 2px solid #cbd5e1; padding-bottom: 6px;">
                        <h4 style="margin: 0; font-size: 15px; color: #1e3a8a;">${emp.user.name}</h4>
                        <span style="font-size: 12px; color: #64748b;">Role: ${emp.user.designation}</span>
                    </div>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; background-color: #ffffff;">
                            <thead>
                                <tr style="background-color: #f1f5f9; color: #475569; border-bottom: 1px solid #cbd5e1;">
                                    <th style="padding: 8px; text-align: left; font-size: 11px; text-transform: uppercase;">Date</th>
                                    <th style="padding: 8px; text-align: center; font-size: 11px; text-transform: uppercase;">First Login</th>
                                    <th style="padding: 8px; text-align: center; font-size: 11px; text-transform: uppercase;">Last Logout</th>
                                    <th style="padding: 8px; text-align: center; font-size: 11px; text-transform: uppercase;">Sessions</th>
                                    <th style="padding: 8px; text-align: right; font-size: 11px; text-transform: uppercase;">Worked Hours</th>
                                    <th style="padding: 8px; text-align: center; font-size: 11px; text-transform: uppercase;">Status</th>
                                    <th style="padding: 8px; text-align: center; font-size: 11px; text-transform: uppercase;">Late</th>
                                    <th style="padding: 8px; text-align: center; font-size: 11px; text-transform: uppercase;">Half Day</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${dailyRowsHtml || `<tr><td colspan="8" style="padding: 10px; text-align: center; color: #94a3b8; font-size: 12px;">No records recorded.</td></tr>`}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        });

        // Main HTML Wrapper
        const mainHtmlTemplate = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${subject}</title>
            </head>
            <body style="background-color: #f3f4f6; margin: 0; padding: 20px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
                <div style="max-width: 800px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                    <!-- Header -->
                    <div style="background-color: #1e3a8a; padding: 25px; text-align: center; border-bottom: 4px solid #2563eb;">
                        <h2 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold; letter-spacing: 0.5px;">Jobs Territory</h2>
                        <p style="color: #93c5fd; margin: 5px 0 0 0; font-size: 14px;">Attendance Management System</p>
                    </div>
                    
                    <!-- Content -->
                    <div style="padding: 30px; color: #1f2937; line-height: 1.6;">
                        <p style="font-size: 16px; margin-top: 0;">Hello ${receiverName || "Admin"},</p>
                        <p style="font-size: 15px;">Please find below the attendance summary for <strong>${reportingPeriodStr}</strong>.</p>
                        
                        <h3 style="color: #1e3a8a; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; font-size: 18px;">Overall Summary</h3>
                        ${overallSummaryHtml}
                        
                        <h3 style="color: #1e3a8a; margin-top: 35px; margin-bottom: 15px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; font-size: 18px;">Employee Summary</h3>
                        ${employeeSummaryTableHtml}
                        
                        <h3 style="color: #1e3a8a; margin-top: 35px; margin-bottom: 15px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; font-size: 18px;">Detailed Employee Attendance Logs</h3>
                        ${detailedUserWiseHtml || `<p style="font-size: 14px; color: #64748b;">No detailed logs available matching active filters.</p>`}
                    </div>
                    
                    <!-- Footer -->
                    <div style="background-color: #f8fafc; padding: 20px; border-top: 1px solid #e5e7eb; text-align: center; color: #64748b; font-size: 12px;">
                        <p style="margin: 0;">This is an automated attendance report. Do not reply directly to this email.</p>
                        <p style="margin: 5px 0 0 0;">&copy; 2026 Jobs Territory. All rights reserved.</p>
                    </div>
                </div>
            </body>
            </html>
        `;
        /*

            subject: subject || `Attendance Report – ${reportingPeriodStr}`,
            html: mainHtmlTemplate,
        };

        if (replyToEmail) {
            mailOptions.replyTo = replyToEmail.trim();
        }

        console.log(`Sending email report. To: ${receiverEmail.trim()}, Subject: ${subject}`);
        await transporter.sendMail(mailOptions);
        */
        console.log(`Sending email report. To: ${receiverEmail.trim()}, Subject: ${subject}`);
        await sendMail({
            fromName: "Jobs Territory Attendance",
            to: receiverEmail.trim(),
            replyTo: req.user?.email,
            subject: subject || `Attendance Report - ${reportingPeriodStr}`,
            html: mainHtmlTemplate,
        });
        console.log("Email sent successfully!");

        res.status(200).json({
            success: true,
            message: "Attendance report email sent successfully.",
        });

    } catch (error) {
        console.error("Error sending attendance report email:", error);
        const emailError = formatEmailErrorResponse(error);
        res.status(500).json({
            success: false,
            ...emailError,
        });
    }
});

// 📄 Get attendance for a specific user
router.get("/user/:userId", async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        let query = { user: req.params.userId };

        // Filter by date range
        if (startDate || endDate) {
            query.date = {};
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                query.date.$gte = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.date.$lte = end;
            }
        }

        const attendanceRecords = await Attendance.find(query)
            .sort({ date: -1 })
            .populate("user", "name email designation profilePhoto");

        res.status(200).json({
            success: true,
            count: attendanceRecords.length,
            data: attendanceRecords,
        });
    } catch (error) {
        console.error("Error fetching user attendance:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// 📅 Get attendance for a specific day
router.get("/daily/:userId/:date", async (req, res) => {
    try {
        const { userId, date } = req.params;

        const targetDate = new Date(date);
        targetDate.setHours(0, 0, 0, 0);

        const endDate = new Date(targetDate);
        endDate.setHours(23, 59, 59, 999);

        const attendance = await Attendance.findOne({
            user: userId,
            date: { $gte: targetDate, $lte: endDate },
        }).populate("user", "name email designation profilePhoto");

        if (!attendance) {
            return res.status(404).json({
                success: false,
                message: "No attendance record found for this date",
            });
        }

        res.status(200).json({
            success: true,
            data: attendance,
        });
    } catch (error) {
        console.error("Error fetching daily attendance:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// 🚀 Record login (start session)
router.post("/login", async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "User ID is required",
            });
        }

        // Detect device type from User-Agent
        const userAgent = req.headers["user-agent"] || "";
        const isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
        const deviceType = isMobile ? "Phone" : "System";

        // Verify user exists
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        // 📋 Skip attendance tracking for Admin users
        if (user.designation === "Admin") {
            return res.status(200).json({
                success: true,
                message: "Attendance tracking skipped for Admin",
            });
        }

        // Get today's date (start and end of day)
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        // Format current time as HH:MM:SS
        const currentTime = now.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });

        // Check if attendance record exists for today
        let attendance = await Attendance.findOne({
            user: userId,
            date: { $gte: startOfDay, $lte: endOfDay },
        });

        if (attendance) {
            // Check if there's an active session
            const activeSession = attendance.sessions.find((s) => s.isActive);

            if (activeSession) {
                // Auto-logout the active session first
                activeSession.logoutTime = currentTime;
                activeSession.isActive = false;
            }

            // Add new session
            attendance.sessions.push({
                loginTime: currentTime,
                isActive: true,
                deviceType: deviceType,
            });

            await attendance.save();
            await attendance.populate("user", "name email designation profilePhoto");

            return res.status(200).json({
                success: true,
                message: "New session started",
                data: attendance,
            });
        }

        // Create new attendance record for today
        attendance = new Attendance({
            user: userId,
            date: startOfDay,
            sessions: [
                {
                    loginTime: currentTime,
                    isActive: true,
                    deviceType: deviceType,
                },
            ],
        });

        await attendance.save();
        await attendance.populate("user", "name email designation profilePhoto");

        res.status(201).json({
            success: true,
            message: "Attendance started successfully",
            data: attendance,
        });
    } catch (error) {
        console.error("Error recording login:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// 🛑 Record logout (end session)
router.post("/logout", async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "User ID is required",
            });
        }

        // Verify user exists and check designation
        const user = await User.findById(userId);
        if (user && user.designation === "Admin") {
            return res.status(200).json({
                success: true,
                message: "Attendance tracking skipped for Admin",
            });
        }

        // Get today's date range
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        // Format current time
        const currentTime = now.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });

        // Find today's attendance record
        const attendance = await Attendance.findOne({
            user: userId,
            date: { $gte: startOfDay, $lte: endOfDay },
        });

        if (!attendance) {
            return res.status(404).json({
                success: false,
                message: "No active attendance record found for today",
            });
        }

        // Find active session
        const activeSession = attendance.sessions.find((s) => s.isActive);

        if (!activeSession) {
            return res.status(404).json({
                success: false,
                message: "No active session found",
            });
        }

        // End the session
        activeSession.logoutTime = currentTime;
        activeSession.isActive = false;

        await attendance.save();
        await attendance.populate("user", "name email designation profilePhoto");

        res.status(200).json({
            success: true,
            message: "Session ended successfully",
            data: attendance,
        });
    } catch (error) {
        console.error("Error recording logout:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// 📊 Get attendance statistics
router.get("/stats", async (req, res) => {
    try {
        const { userId, startDate, endDate } = req.query;

        let query = {};

        if (userId) {
            query.user = userId;
        }

        if (startDate || endDate) {
            query.date = {};
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                query.date.$gte = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.date.$lte = end;
            }
        }

        const attendanceRecords = await Attendance.find(query);

        const stats = {
            totalDays: attendanceRecords.length,
            present: attendanceRecords.filter((a) => a.status === "Present").length,
            absent: attendanceRecords.filter((a) => a.status === "Absent").length,
            halfDay: attendanceRecords.filter((a) => a.status === "Half Day").length,
            leave: attendanceRecords.filter((a) => a.status === "Leave").length,
        };

        res.status(200).json({
            success: true,
            data: stats,
        });
    } catch (error) {
        console.error("Error fetching attendance stats:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// ✏️ Update attendance (admin only - for corrections)
router.put("/:id", async (req, res) => {
    try {
        const { sessions, status } = req.body;

        const attendance = await Attendance.findById(req.params.id);

        if (!attendance) {
            return res.status(404).json({
                success: false,
                message: "Attendance record not found",
            });
        }

        if (sessions) {
            attendance.sessions = sessions;
        }

        if (status) {
            attendance.status = status;
        }

        await attendance.save();
        await attendance.populate("user", "name email designation profilePhoto");

        res.status(200).json({
            success: true,
            message: "Attendance updated successfully",
            data: attendance,
        });
    } catch (error) {
        console.error("Error updating attendance:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

// 🗑️ Delete attendance record (admin only)
router.delete("/:id", async (req, res) => {
    try {
        const attendance = await Attendance.findById(req.params.id);

        if (!attendance) {
            return res.status(404).json({
                success: false,
                message: "Attendance record not found",
            });
        }

        await Attendance.findByIdAndDelete(req.params.id);

        res.status(200).json({
            success: true,
            message: "Attendance record deleted successfully",
        });
    } catch (error) {
        console.error("Error deleting attendance:", error);
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message,
        });
    }
});

module.exports = router;
