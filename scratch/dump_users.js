const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`Connected to: ${conn.connection.host}`);
    
    const User = mongoose.model("User", new mongoose.Schema({}, { strict: false }), "users");
    const users = await User.find({}, { name: 1, email: 1, designation: 1, isAdmin: 1 });
    console.log("Users in database:");
    console.log(JSON.stringify(users, null, 2));
    
    await mongoose.connection.close();
  } catch (error) {
    console.error("Error:", error);
  }
};

connectDB();
