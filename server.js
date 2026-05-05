const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");

// Load environment variables immediately
dotenv.config();

const path = require("path");
const userRoutes = require("./routes/Userroutes");
const authRoutes = require("./routes/Authroutes");
const leaveRoutes = require("./routes/Leavesroutes");
const jobRoutes = require("./routes/Jobroutes");
const CandidatesJob = require("./routes/CandidatesByJobroutes");
const clientRoutes = require("./routes/Clientroutes");
const sessionRoutes = require("./routes/Sessionroutes");
const activityRoutes = require("./routes/Activityroutes");
const invoiceRoutes = require("./routes/Invoiceroutes");
const expenseRoutes = require("./routes/Expenseroutes");
const attendanceRoutes = require("./routes/Attendanceroutes");

// Initialize Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));


// ===== MongoDB Connection =====
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.error(err));

// // Routes

app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/leaves", leaveRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/CandidatesJob", CandidatesJob);
app.use("/api/clients", clientRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/activities", activityRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/attendance", attendanceRoutes);



// Default route
app.get("/", (req, res) => {
  res.send("Jobs Territory ATS API is running");
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`Server running on port ${PORT}`)
);
