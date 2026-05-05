const mongoose = require("mongoose");

const AttendanceSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, "User is required"],
    },
    date: {
        type: Date,
        required: [true, "Date is required"],
    },
    sessions: [
        {
            sessionId: {
                type: String,
                default: () => new mongoose.Types.ObjectId().toString(),
            },
            loginTime: {
                type: String,
                required: true,
            },
            logoutTime: {
                type: String,
            },
            duration: {
                type: String,
                default: "0h 0m",
            },
            isActive: {
                type: Boolean,
                default: true,
            },
            deviceType: {
                type: String,
                enum: ["Phone", "System"],
                default: "System",
            },
        },
    ],
    totalWorkingHours: {
        type: String,
        default: "0h 0m",
    },
    firstLogin: {
        type: String,
    },
    lastLogout: {
        type: String,
    },
    status: {
        type: String,
        enum: ["Present", "Absent", "Half Day", "Leave"],
        default: "Present",
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

// Helper function to calculate duration between two times
function calculateDuration(loginTime, logoutTime) {
    if (!loginTime || !logoutTime) return "0h 0m";

    try {
        const login = new Date(`1970-01-01T${loginTime}`);
        const logout = new Date(`1970-01-01T${logoutTime}`);

        if (logout > login) {
            const diffMs = logout - login;
            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            return `${hours}h ${minutes}m`;
        }
    } catch (error) {
        console.error("Error calculating duration:", error);
    }

    return "0h 0m";
}

// Helper function to convert "Xh Ym" to total minutes
function durationToMinutes(duration) {
    if (!duration || duration === "0h 0m") return 0;

    const match = duration.match(/(\d+)h\s*(\d+)m/);
    if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        return hours * 60 + minutes;
    }
    return 0;
}

// Helper function to convert total minutes to "Xh Ym"
function minutesToDuration(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
}

// Calculate total working hours and update fields before saving
AttendanceSchema.pre("save", function (next) {
    if (this.sessions && this.sessions.length > 0) {
        // Calculate duration for each session
        this.sessions.forEach((session) => {
            if (session.loginTime && session.logoutTime && !session.isActive) {
                session.duration = calculateDuration(session.loginTime, session.logoutTime);
            }
        });

        // Calculate total working hours
        let totalMinutes = 0;
        this.sessions.forEach((session) => {
            if (session.duration && session.duration !== "0h 0m") {
                totalMinutes += durationToMinutes(session.duration);
            }
        });
        this.totalWorkingHours = minutesToDuration(totalMinutes);

        // Set first login and last logout
        const activeSessions = this.sessions.filter((s) => s.loginTime);
        if (activeSessions.length > 0) {
            this.firstLogin = activeSessions[0].loginTime;

            // Find the last logout time
            const sessionsWithLogout = this.sessions.filter((s) => s.logoutTime);
            if (sessionsWithLogout.length > 0) {
                this.lastLogout = sessionsWithLogout[sessionsWithLogout.length - 1].logoutTime;
            }
        }

        // Determine status based on total working hours
        if (totalMinutes < 60) {
            // Less than 1 hour is considered Absent
            this.status = "Absent";
        } else if (totalMinutes < 240) {
            // 1 to 4 hours is considered Half Day
            this.status = "Half Day";
        } else {
            // 4+ hours is considered Present
            this.status = "Present";
        }
    }

    this.updatedAt = Date.now();
    next();
});

// Create compound index for efficient querying
AttendanceSchema.index({ user: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", AttendanceSchema);
