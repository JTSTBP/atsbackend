const mongoose = require("mongoose");

const SessionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, "User is required"],
    },
    date: {
        type: Date,
        required: [true, "Date is required"],
        default: Date.now,
    },
    loginTime: {
        type: String,
        required: [true, "Login time is required"],
    },
    logoutTime: {
        type: String,
    },
    totalHours: {
        type: String,
        default: "0h 0m",
    },
    status: {
        type: String,
        enum: ["Present", "Absent", "Half Day", "Leave"],
        default: "Present",
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    notes: {
        type: String,
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
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

// Calculate total hours before saving
SessionSchema.pre("save", function (next) {
    if (this.loginTime && this.logoutTime) {
        // Ensure time format is HH:mm (pad with leading zero if needed)
        const formatTime = (timeStr) => {
            const parts = timeStr.split(':');
            if (parts.length === 2) {
                const hours = parts[0].padStart(2, '0');
                const minutes = parts[1].padStart(2, '0');
                return `${hours}:${minutes}`;
            }
            return timeStr;
        };

        const login = new Date(`1970-01-01T${formatTime(this.loginTime)}`);
        const logout = new Date(`1970-01-01T${formatTime(this.logoutTime)}`);

        if (logout > login) {
            const diffMs = logout - login;
            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            this.totalHours = `${hours}h ${minutes}m`;
        }
    }

    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model("Session", SessionSchema);
