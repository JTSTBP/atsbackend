const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const { protect } = require("../middleware/authMiddleware");
const Statement = require("../models/Statement");
const StatementUploadBatch = require("../models/StatementUploadBatch");

const router = express.Router();

const MAX_FILE_SIZE_BYTES = Number(process.env.STATEMENT_UPLOAD_MAX_FILE_SIZE_BYTES) || 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".xlsx", ".xls"];
const ALLOWED_MIME_TYPES = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/octet-stream",
];

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_FILE_SIZE_BYTES,
        files: 1,
    },
    fileFilter: (req, file, cb) => {
        const fileName = file.originalname || "";
        const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();

        if (!ALLOWED_EXTENSIONS.includes(extension)) {
            return cb(new Error("Unsupported file type. Please upload only .xlsx or .xls files."));
        }

        if (file.mimetype && !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            return cb(new Error("Invalid file content type. Please upload a valid Excel file."));
        }

        cb(null, true);
    },
});

const uploadStatementFile = upload.single("file");

const maskAccountNumber = (accountNumber) => {
    const value = String(accountNumber || "");
    if (value.length <= 4) return value.replace(/.(?=.)/g, "*");
    return `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
};

const generateBulkUploadId = () => {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `STMT-${datePart}-${randomPart}`;
};

const normalizeHeader = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

const getCellValue = (row, columnIndex) => String(row[columnIndex] ?? "").trim();

const generateStatementFingerprint = ({ accountNumber, transactionType, amount, reason }) => {
    return [
        String(accountNumber || "").trim(),
        String(transactionType || "").trim().toLowerCase(),
        Number(amount).toFixed(2),
        String(reason || "").trim().toLowerCase(),
    ].join("|");
};

const parseAmount = (value) => {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) return { value: null, error: "Amount is required." };

    const normalized = trimmed.replace(/,/g, "");
    if (!/^\d+(\.\d+)?$/.test(normalized)) {
        return { value: null, error: "Amount must be a valid numeric value." };
    }

    const numericAmount = Number(normalized);
    if (!Number.isFinite(numericAmount)) {
        return { value: null, error: "Amount must be a valid numeric value." };
    }

    if (numericAmount <= 0) {
        return { value: null, error: "Amount must be greater than zero" };
    }

    return { value: numericAmount, error: null };
};

const isEmptyRow = (row) => row.every((cell) => String(cell ?? "").trim() === "");

const normalizeType = (value) => {
    const normalized = String(value || "").trim().toLowerCase();

    if (normalized === "debit" || normalized === "debited") return "debited";
    if (normalized === "credit" || normalized === "credited") return "credited";
    return normalized;
};

const validateStatementRows = (sheetRows, bulkUploadId) => {
    if (!sheetRows.length) {
        return {
            validRows: [],
            invalidRows: [],
            totalRows: 0,
            ignoredEmptyRows: 0,
        };
    }

    const headers = sheetRows[0].map(normalizeHeader);
    const columnIndexes = {
        accountNumber: headers.indexOf("account number"),
        type: headers.indexOf("type"),
        amount: headers.indexOf("amount"),
        reason: headers.indexOf("reason"),
    };

    const missingColumns = Object.entries(columnIndexes)
        .filter(([, index]) => index === -1)
        .map(([key]) => {
            if (key === "accountNumber") return "account number";
            return key;
        });

    if (missingColumns.length) {
        return {
            validRows: [],
            invalidRows: [
                {
                    row: 1,
                    errors: [`Missing required column(s): ${missingColumns.join(", ")}`],
                },
            ],
            totalRows: 0,
            ignoredEmptyRows: 0,
        };
    }

    const validRows = [];
    const invalidRows = [];
    let ignoredEmptyRows = 0;

    sheetRows.slice(1).forEach((row, index) => {
        const excelRowNumber = index + 2;

        if (isEmptyRow(row)) {
            ignoredEmptyRows += 1;
            return;
        }

        const accountNumber = getCellValue(row, columnIndexes.accountNumber);
        const type = normalizeType(getCellValue(row, columnIndexes.type));
        const amountResult = parseAmount(getCellValue(row, columnIndexes.amount));
        const reason = getCellValue(row, columnIndexes.reason);
        const errors = [];

        if (!accountNumber) {
            errors.push("Account Number is required.");
        }

        if (!type) {
            errors.push("Type is required.");
        } else if (!["debited", "credited"].includes(type)) {
            errors.push("Type must be either debited or credited.");
        }

        if (amountResult.error) {
            errors.push(amountResult.error);
        }

        if (!reason) {
            errors.push("Reason is required.");
        }

        if (errors.length) {
            invalidRows.push({
                row: excelRowNumber,
                errors,
            });
            return;
        }

        validRows.push({
            row: excelRowNumber,
            accountNumber,
            transactionType: type,
            amount: amountResult.value,
            reason,
            fingerprint: generateStatementFingerprint({ accountNumber, transactionType: type, amount: amountResult.value, reason }),
            bulkUploadId,
        });
    });

    return {
        validRows,
        invalidRows,
        totalRows: validRows.length + invalidRows.length,
        ignoredEmptyRows,
    };
};

const parseWorkbookRows = (buffer, bulkUploadId) => {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
        return {
            sheetName: null,
            validRows: [],
            invalidRows: [],
            totalRows: 0,
            ignoredEmptyRows: 0,
        };
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const sheetRows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: "",
        raw: false,
        blankrows: false,
    });

    return {
        sheetName: firstSheetName,
        ...validateStatementRows(sheetRows, bulkUploadId),
    };
};

router.post("/upload", protect, (req, res) => {
    uploadStatementFile(req, res, async (uploadError) => {
        if (uploadError) {
            const statusCode = uploadError instanceof multer.MulterError ? 400 : 415;
            const message = uploadError.code === "LIMIT_FILE_SIZE"
                ? `File is too large. Maximum allowed size is ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))} MB.`
                : uploadError.message;

            return res.status(statusCode).json({
                success: false,
                message,
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No Excel file uploaded. Please attach a file using the field name 'file'.",
            });
        }

        const bulkUploadId = generateBulkUploadId();

        try {
            const { sheetName, validRows, invalidRows, totalRows, ignoredEmptyRows } = parseWorkbookRows(req.file.buffer, bulkUploadId);
            const uploadedBy = req.user?._id;

            if (!uploadedBy) {
                return res.status(401).json({
                    success: false,
                    message: "Authenticated user not found.",
                });
            }

            const fingerprints = validRows.map((row) => row.fingerprint);
            const existingStatements = fingerprints.length
                ? await Statement.find({ fingerprint: { $in: fingerprints } }).select("fingerprint")
                : [];
            const existingFingerprintSet = new Set(existingStatements.map((statement) => statement.fingerprint));
            const seenUploadFingerprints = new Set();
            const duplicateRows = [];
            const rowsToSave = [];

            validRows.forEach((row) => {
                if (existingFingerprintSet.has(row.fingerprint) || seenUploadFingerprints.has(row.fingerprint)) {
                    duplicateRows.push({
                    row: row.row,
                    accountNumber: row.accountNumber,
                    transactionType: row.transactionType,
                    amount: row.amount,
                    reason: row.reason,
                    errors: ["Duplicate statement record already exists."],
                });
                    return;
                }

                seenUploadFingerprints.add(row.fingerprint);
                rowsToSave.push(row);
            });

            const status = invalidRows.length > 0 || duplicateRows.length > 0 ? "completed_with_errors" : "completed";

            const statementDocs = rowsToSave.map((row) => ({
                accountNumber: row.accountNumber,
                transactionType: row.transactionType,
                amount: row.amount,
                reason: row.reason,
                fingerprint: row.fingerprint,
                bulkUploadId,
                uploadedBy,
                source: "excel_bulk_upload",
            }));

            const savedStatements = statementDocs.length
                ? await Statement.insertMany(statementDocs, { ordered: false })
                : [];
            const totalAmountDebited = savedStatements
                .filter((statement) => statement.transactionType === "debited")
                .reduce((sum, statement) => sum + Number(statement.amount || 0), 0);
            const totalAmountCredited = savedStatements
                .filter((statement) => statement.transactionType === "credited")
                .reduce((sum, statement) => sum + Number(statement.amount || 0), 0);

            await StatementUploadBatch.create({
                bulkUploadId,
                uploadedBy,
                uploadedAt: new Date(),
                originalFilename: req.file.originalname,
                totalRows,
                successfulRows: savedStatements.length,
                failedRows: invalidRows.length + duplicateRows.length,
                status,
                validationErrors: invalidRows,
                duplicateRows,
                totalAmountDebited,
                totalAmountCredited,
                ignoredEmptyRows,
            });

            return res.status(200).json({
                success: invalidRows.length === 0 && duplicateRows.length === 0,
                message: invalidRows.length || duplicateRows.length
                    ? "Statement file parsed with skipped rows."
                    : "Statement file parsed and validated successfully.",
                bulkUploadId,
                file: {
                    originalName: req.file.originalname,
                    size: req.file.size,
                    mimeType: req.file.mimetype,
                },
                sheetName,
                summary: {
                    totalRows,
                    savedRows: savedStatements.length,
                    failedRows: invalidRows.length,
                    duplicateRows: duplicateRows.length,
                    validationErrors: invalidRows.length,
                    totalAmountDebited,
                    totalAmountCredited,
                    ignoredEmptyRows,
                    status,
                },
                savedRows: savedStatements.length,
                failedRows: invalidRows.length,
                duplicateRows: duplicateRows.length,
                duplicates: duplicateRows,
                validationErrors: invalidRows,
            });
        } catch (error) {
            console.error("Statement upload error:", error);
            if (req.user?._id) {
                await StatementUploadBatch.create({
                    bulkUploadId,
                    uploadedBy: req.user._id,
                    uploadedAt: new Date(),
                    originalFilename: req.file.originalname,
                    totalRows: 0,
                    successfulRows: 0,
                    failedRows: 0,
                    status: "failed",
                }).catch((batchError) => {
                    console.error("Statement upload failed batch log error:", batchError);
                });
            }
            return res.status(422).json({
                success: false,
                bulkUploadId,
                message: "Unable to process the Excel upload. Please check the file format and try again.",
            });
        }
    });
});

router.get("/", protect, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = "",
            transactionType,
            uploadedBy,
            bulkUploadId,
            startDate,
            endDate,
        } = req.query;

        const pageNumber = Math.max(Number(page) || 1, 1);
        const pageSize = Math.min(Math.max(Number(limit) || 10, 1), 100);
        const query = {};

        if (transactionType && ["debited", "credited"].includes(String(transactionType).toLowerCase())) {
            query.transactionType = String(transactionType).toLowerCase();
        }

        if (uploadedBy) {
            query.uploadedBy = uploadedBy;
        }

        if (bulkUploadId) {
            query.bulkUploadId = String(bulkUploadId).trim();
        }

        if (startDate || endDate) {
            query.uploadedAt = {};
            if (startDate) {
                query.uploadedAt.$gte = new Date(startDate);
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.uploadedAt.$lte = end;
            }
        }

        const trimmedSearch = String(search).trim();
        if (trimmedSearch) {
            const searchRegex = new RegExp(trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
            query.$or = [
                { accountNumber: searchRegex },
                { transactionType: searchRegex },
                { reason: searchRegex },
                { bulkUploadId: searchRegex },
            ];

            const numericSearch = Number(trimmedSearch.replace(/,/g, ""));
            if (Number.isFinite(numericSearch)) {
                query.$or.push({ amount: numericSearch });
            }
        }

        const [statements, total] = await Promise.all([
            Statement.find(query)
                .populate("uploadedBy", "name email designation")
                .sort({ uploadedAt: -1, createdAt: -1 })
                .skip((pageNumber - 1) * pageSize)
                .limit(pageSize),
            Statement.countDocuments(query),
        ]);

        return res.status(200).json({
            success: true,
            data: statements.map((statement) => ({
                _id: statement._id,
                bulkUploadId: statement.bulkUploadId,
                accountNumber: maskAccountNumber(statement.accountNumber),
                transactionType: statement.transactionType,
                amount: statement.amount,
                reason: statement.reason,
                uploadedBy: statement.uploadedBy,
                uploadedAt: statement.uploadedAt,
                source: statement.source,
            })),
            pagination: {
                page: pageNumber,
                limit: pageSize,
                total,
                totalPages: Math.ceil(total / pageSize),
            },
        });
    } catch (error) {
        console.error("Error fetching statements:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch uploaded statements.",
        });
    }
});

router.get("/batches", protect, async (req, res) => {
    try {
        const { page = 1, limit = 10, search = "", status, uploadedBy, startDate, endDate } = req.query;
        const pageNumber = Math.max(Number(page) || 1, 1);
        const pageSize = Math.min(Math.max(Number(limit) || 10, 1), 100);
        const query = {};

        if (status && ["completed", "completed_with_errors", "failed"].includes(String(status))) {
            query.status = status;
        }

        if (uploadedBy) {
            query.uploadedBy = uploadedBy;
        }

        if (startDate || endDate) {
            query.uploadedAt = {};
            if (startDate) query.uploadedAt.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.uploadedAt.$lte = end;
            }
        }

        const trimmedSearch = String(search).trim();
        if (trimmedSearch) {
            const searchRegex = new RegExp(trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
            query.$or = [
                { bulkUploadId: searchRegex },
                { originalFilename: searchRegex },
                { status: searchRegex },
            ];
        }

        const [batches, total] = await Promise.all([
            StatementUploadBatch.find(query)
                .populate("uploadedBy", "name email designation")
                .sort({ uploadedAt: -1, createdAt: -1 })
                .skip((pageNumber - 1) * pageSize)
                .limit(pageSize),
            StatementUploadBatch.countDocuments(query),
        ]);

        return res.status(200).json({
            success: true,
            data: batches,
            pagination: {
                page: pageNumber,
                limit: pageSize,
                total,
                totalPages: Math.ceil(total / pageSize),
            },
        });
    } catch (error) {
        console.error("Error fetching statement upload batches:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch upload history.",
        });
    }
});

router.get("/batches/:bulkUploadId", protect, async (req, res) => {
    try {
        const { bulkUploadId } = req.params;
        const batch = await StatementUploadBatch.findOne({ bulkUploadId })
            .populate("uploadedBy", "name email designation");

        if (!batch) {
            return res.status(404).json({
                success: false,
                message: "Upload batch not found.",
            });
        }

        const statements = await Statement.find({ bulkUploadId })
            .populate("uploadedBy", "name email designation")
            .sort({ createdAt: 1 });

        return res.status(200).json({
            success: true,
            batch,
            summary: {
                totalRows: batch.totalRows,
                rowsUploaded: batch.successfulRows,
                failedRows: batch.failedRows,
                validationErrors: batch.validationErrors?.length || 0,
                duplicateRows: batch.duplicateRows?.length || 0,
                totalAmountDebited: batch.totalAmountDebited || 0,
                totalAmountCredited: batch.totalAmountCredited || 0,
                ignoredEmptyRows: batch.ignoredEmptyRows || 0,
                status: batch.status,
            },
            statements: statements.map((statement) => ({
                _id: statement._id,
                bulkUploadId: statement.bulkUploadId,
                accountNumber: maskAccountNumber(statement.accountNumber),
                transactionType: statement.transactionType,
                amount: statement.amount,
                reason: statement.reason,
                uploadedBy: statement.uploadedBy,
                uploadedAt: statement.uploadedAt,
                source: statement.source,
            })),
            validationErrors: batch.validationErrors || [],
            duplicateRows: (batch.duplicateRows || []).map((row) => ({
                row: row.row,
                accountNumber: maskAccountNumber(row.accountNumber),
                transactionType: row.transactionType,
                amount: row.amount,
                reason: row.reason,
                errors: row.errors,
            })),
        });
    } catch (error) {
        console.error("Error fetching statement upload batch details:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch upload batch details.",
        });
    }
});

module.exports = router;
