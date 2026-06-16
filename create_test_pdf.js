const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const doc = new PDFDocument();
const outputPath = path.join(__dirname, "sample_resume.pdf");
const stream = fs.createWriteStream(outputPath);

doc.pipe(stream);

doc.fontSize(24).text("Anurag Pal", { align: "center" });
doc.fontSize(14).text("Senior Software Engineer", { align: "center" });
doc.moveDown();

doc.fontSize(12).text("Email: anurag.pal@gmail.com");
doc.text("Phone: +91 9876543210");
doc.text("Location: Pune, India");
doc.text("LinkedIn: linkedin.com/in/anurag-pal");
doc.moveDown();

doc.fontSize(16).text("Summary", { underline: true });
doc.fontSize(12).text("Result-oriented Software Engineer with 5 years of experience in full-stack web development. Experienced with React, Node.js, Express, JavaScript, TypeScript, MongoDB, and AWS.");
doc.moveDown();

doc.fontSize(16).text("Experience", { underline: true });
doc.fontSize(12).text("Acme Corporation - Senior Software Engineer (2023 - Present)");
doc.text("Infosys - Software Developer (2021 - 2023)");
doc.text("Worked on various web applications using React and Node.js. Total experience is 5 years.");
doc.moveDown();

doc.fontSize(16).text("Education", { underline: true });
doc.fontSize(12).text("B.Tech in Computer Science from IIT Bombay");
doc.moveDown();

doc.fontSize(16).text("Certifications", { underline: true });
doc.fontSize(12).text("AWS Certified Developer, Certified Scrum Master");
doc.moveDown();

doc.fontSize(16).text("Notice Period & Salary Details", { underline: true });
doc.fontSize(12).text("Expected Salary: 15 LPA");
doc.text("Notice Period: 30 Days");

doc.end();

stream.on("finish", () => {
  console.log("✅ Created sample_resume.pdf successfully at:", outputPath);
});
