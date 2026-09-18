const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const check = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const User = mongoose.model("User", new mongoose.Schema({}, { strict: false }), "users");
    
    const managers = await User.find({ designation: { $regex: /manager/i } }, { name: 1, email: 1, designation: 1 });
    console.log("Managers found:", managers.length);
    for (const m of managers) {
      console.log(`\n=== MANAGER: ${m.name} (${m.email}, ID: ${m._id}) ===`);
      const reportees = await User.find({ reporter: m._id }, { name: 1, email: 1, designation: 1 });
      console.log(`Direct reportees (${reportees.length}):`);
      for (const rep of reportees) {
        console.log(`  - [${rep.designation}] ${rep.name} (${rep.email}, ID: ${rep._id})`);
        const sub = await User.find({ reporter: rep._id }, { name: 1, email: 1, designation: 1 });
        console.log(`    Sub-reportees (${sub.length}):`);
        for (const s of sub) {
          console.log(`      * [${s.designation}] ${s.name} (${s.email}, ID: ${s._id})`);
        }
      }
    }

    // Also check all mentors in DB and who their reporter is:
    console.log("\n=== ALL MENTORS IN DB ===");
    const mentors = await User.find({ designation: { $regex: /mentor/i } }, { name: 1, email: 1, designation: 1, reporter: 1 });
    for (const ment of mentors) {
      console.log(`Mentor: ${ment.name} (${ment.email}, ID: ${ment._id}), Reporter: ${ment.reporter}`);
      const recs = await User.find({ reporter: ment._id }, { name: 1, email: 1, designation: 1 });
      console.log(`  Recruiters under mentor (${recs.length}):`);
      for (const r of recs) {
        console.log(`    - [${r.designation}] ${r.name} (${r.email}, ID: ${r._id})`);
      }
    }
    
    await mongoose.connection.close();
  } catch (err) {
    console.error("Error:", err);
  }
};

check();
