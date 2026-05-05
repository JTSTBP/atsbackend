const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
    },
    amount: {
        type: Number,
        required: true,
    },
    category: {
        type: String,
        required: true,
        enum: ["Food", "Transport", "Office Supplies", "Utilities", "Rent", "Salaries", "Marketing", "Software", "Other"],
        default: "Other"
    },
    date: {
        type: Date,
        default: Date.now,
    },
    description: {
        type: String,
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
}, { timestamps: true });

module.exports = mongoose.model("Expense", expenseSchema);
