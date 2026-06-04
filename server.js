const dotenv = require("dotenv");
const path = require("path");
dotenv.config({ path: path.join(__dirname, ".env") });

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const userRoutes = require("./routes/Userroutes");
const authRoutes = require("./routes/Authroutes");
const leaveRoutes = require("./routes/Leavesroutes");
const jobRoutes = require("./routes/Jobroutes");
const CandidatesJob = require("./routes/CandidatesByJobroutes");
const sourceCandidateRoutes = require("./routes/SourceCandidateroutes");
const clientRoutes = require("./routes/Clientroutes");
const sessionRoutes = require("./routes/Sessionroutes");
const activityRoutes = require("./routes/Activityroutes");
const invoiceRoutes = require("./routes/Invoiceroutes");
const expenseRoutes = require("./routes/Expenseroutes");
const attendanceRoutes = require("./routes/Attendanceroutes");
const returnInvoiceRoutes = require("./routes/ReturnInvoiceroutes");

// Initialize Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));



// ===== Routes =====
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/leaves", leaveRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/CandidatesJob", CandidatesJob);
app.use("/api/source-candidates", sourceCandidateRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/activities", activityRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/return-invoices", returnInvoiceRoutes);

// Serve frontend dist
app.use(express.static(path.join(__dirname, "dist")));

// React/Vite fallback route
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

// ===== MongoDB Connection & Server Start =====
mongoose.set('strictQuery', false);

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is not defined in environment variables. If you are deploying, make sure to add it to your platform's Environment Variables (Config Vars).");
    }

    console.log("⏳ Connecting to MongoDB...");
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 20000,
    });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, "0.0.0.0", () =>
      console.log(`🚀 Server running on port ${PORT}`)
    );
  } catch (error) {
    console.error("❌ MongoDB Connection Error:", error.message);
    
    if (error.message.includes('buffering timed out')) {
      console.error("TIP: Check your IP whitelisting in MongoDB Atlas and your internet connection.");
    }
    
    if (!process.env.MONGO_URI) {
      console.error("CRITICAL: MONGO_URI is missing. Did you forget to set it in your deployment platform's settings?");
    }
    
    process.exit(1);
  }
};

connectDB();

const db = mongoose.connection;
db.on('error', (err) => console.error('❌ Mongoose connection error:', err));
db.on('disconnected', () => console.log('⚠️ Mongoose disconnected'));
db.on('reconnected', () => console.log('✅ Mongoose reconnected'));
