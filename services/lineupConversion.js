const fieldKey = value => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const getLineupForm = (candidate, job) => {
  const fields = (job.candidateFields || []).map(field => ({
    name: field.name, type: field.type, required: Boolean(field.required), options: field.options || [],
  }));
  const defaults = { candidateName: candidate.name || "", Email: candidate.email || "", Phone: candidate.phoneNumber || "" };
  const values = { ...defaults };
  fields.forEach(field => {
    const key = fieldKey(field.name);
    const sourceKey = Object.keys(candidate).find(name => fieldKey(name) === key);
    values[field.name] = sourceKey ? candidate[sourceKey] : "";
    if (["name", "candidatename", "fullname"].includes(key)) values[field.name] = defaults.candidateName;
    if (field.type === "email" || key.includes("email")) values[field.name] = defaults.Email;
    if (field.type === "tel" || /phone|mobile|contactnumber/.test(key)) values[field.name] = defaults.Phone;
    if (field.type === "tags" && Array.isArray(values[field.name])) values[field.name] = values[field.name].join(", ");
    if (values[field.name] && typeof values[field.name] === "object") values[field.name] = "";
  });
  for (const [name, type] of [["candidateName", "text"], ["Email", "email"], ["Phone", "tel"]]) {
    const existing = fields.find(field => name === "candidateName" ? ["name", "candidatename", "fullname"].includes(fieldKey(field.name)) : field.type === type);
    if (existing) existing.required = true;
    else fields.unshift({ name, type, required: true, options: [] });
  }
  return { fields, values };
};

const validateLineupFields = (fields, values) => {
  const errors = [];
  const dynamicFields = {};
  fields.forEach(field => {
    const raw = values[field.name];
    const value = Array.isArray(raw) ? raw.map(item => String(item).trim()).filter(Boolean) : String(raw ?? "").trim();
    const empty = value.length === 0;
    if (field.required && empty) errors.push(`${field.name} is required`);
    if (!empty && field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) errors.push(`${field.name} must be a valid email`);
    if (!empty && field.type === "tel" && !/^\d{10,15}$/.test(String(value).replace(/\D/g, ""))) errors.push(`${field.name} must be a valid phone number`);
    if (!empty && field.type === "number" && !Number.isFinite(Number(value))) errors.push(`${field.name} must be a number`);
    if (!empty && field.type === "select" && field.options.length && !field.options.includes(value)) errors.push(`Select a valid ${field.name}`);
    dynamicFields[field.name] = field.type === "tags" ? (Array.isArray(value) ? value : value.split(",").map(item => item.trim()).filter(Boolean)) : value;
  });
  // Keep the standard contact aliases used throughout the normal candidate list.
  const nameField = fields.find(field => ["name", "candidatename", "fullname"].includes(fieldKey(field.name)));
  const emailField = fields.find(field => field.type === "email");
  const phoneField = fields.find(field => field.type === "tel");
  if (nameField) dynamicFields.candidateName = dynamicFields[nameField.name];
  if (emailField) dynamicFields.Email = dynamicFields[emailField.name];
  if (phoneField) dynamicFields.Phone = dynamicFields[phoneField.name];
  return { errors, dynamicFields };
};

module.exports = { getLineupForm, validateLineupFields };
