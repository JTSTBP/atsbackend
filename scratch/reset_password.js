const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const resetPassword = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`Connected to: ${conn.connection.host}`);
    
    // Define simple User schema to match
    const UserSchema = new mongoose.Schema({
      email: String,
      password: { type: String, required: true }
    });
    
    const User = mongoose.model("UserPasswordReset", UserSchema, "users");
    
    const email = "radhika@jobsterritory.com";
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash("password123", salt);
    
    const result = await User.updateOne(
      { email },
      { $set: { password: hashedPassword } }
    );
    
    if (result.matchedCount > 0) {
      console.log(`Password reset successfully for ${email}`);
    } else {
      console.log(`User ${email} not found`);
    }
    
    await mongoose.connection.close();
  } catch (error) {
    console.error("Error:", error);
  }
};

resetPassword();
