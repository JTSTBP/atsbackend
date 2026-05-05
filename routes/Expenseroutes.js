const express = require("express");
const router = express.Router();
const Expense = require("../models/Expense");

// Create a new expense
router.post("/create", async (req, res) => {
    try {
        const { title, amount, category, date, description, createdBy } = req.body;

        const newExpense = new Expense({
            title,
            amount,
            category,
            date: date || Date.now(),
            description,
            createdBy,
        });

        await newExpense.save();
        res.status(201).json({ success: true, message: "Expense added successfully", expense: newExpense });
    } catch (error) {
        console.error("Error adding expense:", error);
        res.status(500).json({ success: false, message: "Failed to add expense" });
    }
});

// Get all expenses
router.get("/all", async (req, res) => {
    try {
        const { category, startDate, endDate } = req.query;
        let query = {};

        if (category) query.category = category;
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.date.$lte = end;
            }
        }

        const expenses = await Expense.find(query)
            .populate("createdBy", "name email")
            .sort({ date: -1 });
        res.status(200).json(expenses);
    } catch (error) {
        console.error("Error fetching expenses:", error);
        res.status(500).json({ success: false, message: "Failed to fetch expenses" });
    }
});

// Delete an expense
router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        await Expense.findByIdAndDelete(id);
        res.status(200).json({ success: true, message: "Expense deleted successfully" });
    } catch (error) {
        console.error("Error deleting expense:", error);
        res.status(500).json({ success: false, message: "Failed to delete expense" });
    }
});

module.exports = router;
