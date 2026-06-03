const multer = require('multer');
const XLSX = require('xlsx');
const upload = multer({ storage: multer.memoryStorage() });
const express = require('express');
const router = express.Router();

// Bulk upload expenses via Excel/CSV
router.get('/sample-template', (req, res) => {
    try {
        const VALID_CATEGORIES = ['Food', 'Transport', 'Office Supplies', 'Utilities', 'Rent', 'Salaries', 'Marketing', 'Software', 'Other'];

        const sampleData = [
            { title: 'Office Stationery', amount: 1500, category: 'Office Supplies', date: '2024-05-28', description: 'Pens, notebooks etc.' },
            { title: 'Team Lunch',        amount: 2200, category: 'Food',            date: '2024-05-27', description: 'Team outing lunch'   },
            { title: 'Cab Reimbursement', amount: 500,  category: 'Transport',       date: '2024-05-26', description: 'Client visit travel'  },
        ];

        // Main data sheet
        const ws = XLSX.utils.json_to_sheet(sampleData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Expenses Template');

        // Info sheet with valid categories
        const infoData = [
            { 'Valid Categories (use exactly as shown)': 'Food' },
            { 'Valid Categories (use exactly as shown)': 'Transport' },
            { 'Valid Categories (use exactly as shown)': 'Office Supplies' },
            { 'Valid Categories (use exactly as shown)': 'Utilities' },
            { 'Valid Categories (use exactly as shown)': 'Rent' },
            { 'Valid Categories (use exactly as shown)': 'Salaries' },
            { 'Valid Categories (use exactly as shown)': 'Marketing' },
            { 'Valid Categories (use exactly as shown)': 'Software' },
            { 'Valid Categories (use exactly as shown)': 'Other' },
        ];
        const wsInfo = XLSX.utils.json_to_sheet(infoData);
        XLSX.utils.book_append_sheet(wb, wsInfo, 'Valid Categories');
        
        const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
        
        res.setHeader('Content-Disposition', 'attachment; filename="expenses_template.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(excelBuffer);
    } catch (error) {
        console.error('Error generating template:', error);
        res.status(500).json({ success: false, message: 'Failed to generate template' });
    }
});

router.post('/bulk-upload', upload.single('file'), async (req, res) => {
  try {
    let rows = [];
    if (req.file) {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const ws = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    } else if (Array.isArray(req.body.expenses)) {
      rows = req.body.expenses;
    }
    const created = [];
    const errors = [];
    const createdBy = req.body.createdBy; // Get from FormData

    for (const [i, row] of rows.entries()) {
      const { title, amount, category, date, description } = row;
      const rowCreatedBy = row.createdBy || createdBy;

      if (!title || !amount || !category || !rowCreatedBy) {
        errors.push({ index: i, message: 'Missing required fields' });
        continue;
      }
      try {
        const expense = new Expense({
          title,
          amount: Number(amount),
          category,
          date: date ? new Date(date) : undefined,
          description,
          createdBy: rowCreatedBy,
        });
        await expense.save();
        created.push(expense);
      } catch (e) {
        errors.push({ index: i, message: e.message });
      }
    }
    res.status(200).json({ createdCount: created.length, errors });
  } catch (err) {
    console.error('Bulk upload error:', err);
    res.status(500).json({ success: false, message: 'Bulk upload failed' });
  }
});

// router already defined above
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
