/**
 * Site form templates. Plain data: the API validates against them and the website draws them, so adding or changing a form
 * means editing this file only.
 *
 * template  { code, version, name, prefix, description, statuses[], statusLabels?, sections[] }
 * section   { id, title, fields[] }                                   a group of fields
 *           { id, title, type: "checklist", items[{id,label}] }       each item answered pass / fail / n/a (+ note; a fail needs a note)
 *           { id, title, type: "table", columns[], minRows?, printRows?, track? }   repeating rows
 * field     { id, label, type: text|longtext|number|date|time|select|yesno, options?, unit?, required?, requiredAt? }
 *
 * `required` means "needed as soon as the form leaves draft"; `requiredAt: "answered"` means "needed from that status onwards".
 * RULES for changing a released template: never change an id or reuse one; add new fields/items at the END; raise `version`.
 * `track: { column, closed: [...] }` on a table counts rows whose status is not closed (open snags, open actions).
 */
const t = (id, label, extra = {}) => ({ id, label, type: "text", ...extra });
const long = (id, label, extra = {}) => ({ id, label, type: "longtext", ...extra });
const num = (id, label, extra = {}) => ({ id, label, type: "number", ...extra });
const date = (id, label, extra = {}) => ({ id, label, type: "date", ...extra });
const time = (id, label, extra = {}) => ({ id, label, type: "time", ...extra });
const pick = (id, label, options, extra = {}) => ({ id, label, type: "select", options, ...extra });
const yn = (id, label, extra = {}) => ({ id, label, type: "yesno", ...extra });
const checklist = (id, title, labels, extra = {}) => ({ id, title, type: "checklist", items: labels.map((label, i) => ({ id: `${id}${i + 1}`, label })), ...extra });
const table = (id, title, columns, extra = {}) => ({ id, title, type: "table", columns, ...extra });

const DISCIPLINES = ["Architectural", "Structural", "Civil", "Mechanical", "Electrical", "Plumbing", "Other"];

export const TEMPLATES = [
  // ----------------------------------------------------------------------------------------------------------- 1
  {
    code: "DSR", version: 1, name: "Daily Site Report", prefix: "DSR", statuses: ["draft", "submitted", "reviewed"],
    description: "What happened on site today: weather, labour, equipment, materials received, progress, delays and safety.",
    sections: [
      { id: "conditions", title: "Site conditions", fields: [
        pick("weather", "Weather", ["Sunny", "Cloudy", "Light rain", "Heavy rain", "Work stopped by weather"], { required: true }),
        pick("ground", "Ground conditions", ["Dry", "Wet", "Muddy", "Waterlogged"]),
        time("start_time", "Site opened"), time("end_time", "Site closed"), num("hours_lost", "Hours lost (weather or other)", { unit: "h" }),
        t("prepared_by", "Prepared by", { required: true }), t("supervisor", "Site supervisor"),
      ] },
      table("labour", "Labour on site", [t("trade", "Trade / role", { required: true }), t("company", "Company / subcontractor"), num("workers", "Workers", { required: true }), num("hours", "Hours worked"), t("remarks", "Remarks")], { printRows: 8 }),
      table("equipment", "Equipment and plant", [t("item", "Equipment", { required: true }), num("hours", "Hours used"), pick("status", "Status", ["Working", "Idle", "Breakdown"]), t("operator", "Operator")], { printRows: 5 }),
      table("materials", "Materials received", [t("material", "Material", { required: true }), num("quantity", "Quantity"), t("unit", "Unit"), t("supplier", "Supplier"), t("delivery_note", "Delivery note no.")], { printRows: 5 }),
      { id: "progress", title: "Progress", fields: [
        long("work_done", "Work done today", { required: true }), long("work_planned", "Work planned for tomorrow"), num("percent_complete", "Overall progress", { unit: "%" }),
        long("delays", "Delays and problems"), long("instructions", "Instructions received / variations"), long("visitors", "Visitors and inspections"),
      ] },
      { id: "safety", title: "Health and safety", fields: [
        yn("toolbox", "Toolbox talk held today?", { required: true }), yn("ppe", "PPE worn by everyone on site?", { required: true }),
        long("incidents", "Accidents, incidents or near misses (write 'None' if none)", { required: true }),
      ] },
      { id: "signoff", title: "Review", fields: [t("reviewed_by", "Reviewed by", { requiredAt: "reviewed" }), date("reviewed_date", "Review date", { requiredAt: "reviewed" })] },
    ],
  },

  // ----------------------------------------------------------------------------------------------------------- 2
  {
    code: "SIC", version: 1, name: "Site Inspection Checklist", prefix: "SIC", statuses: ["draft", "completed", "closed"],
    statusLabels: { completed: "Completed", closed: "Closed (actions done)" },
    description: "A walk-round inspection of housekeeping, safety, plant and quality of work, with actions to close out.",
    sections: [
      { id: "details", title: "Inspection details", fields: [
        pick("type", "Type of inspection", ["General", "Safety", "Quality", "Pre-pour", "Pre-plaster / finishing", "Handover", "Other"], { required: true }),
        t("area", "Area / location inspected", { required: true }), t("inspector", "Inspector", { required: true }), t("present", "People present"),
      ] },
      checklist("hk", "Housekeeping and access", ["Site is tidy and walkways are clear", "Materials are stored safely and neatly", "Waste and debris are removed regularly", "Safe access and exit to all work areas", "Site hoarding / fencing is intact", "Signs and warning notices are displayed"]),
      checklist("sf", "Safety and PPE", ["Workers wear helmets, boots and high-visibility clothing", "Task PPE worn where needed (gloves, goggles, masks, harnesses)", "First aid kit is stocked and easy to reach", "Fire extinguishers are present and in date", "Toolbox talk records are available", "Emergency contacts and assembly point are displayed", "Workers have been inducted"]),
      checklist("wh", "Excavations, scaffolds and lifting", ["Excavations are shored or barricaded", "Scaffold is tagged, tied and fully boarded", "Ladders are in good condition and secured", "Lifting equipment has been inspected", "Edge protection and guardrails are in place"]),
      checklist("ev", "Electrical, plant and environment", ["Temporary electrics are safe (cables raised, RCD protected)", "Machines are guarded and maintained", "Fuel and chemicals are stored safely", "Dust, noise and water run-off are controlled", "Drinking water and sanitary facilities are available"]),
      checklist("ql", "Quality of work", ["Setting out and levels have been checked", "Work matches the latest approved drawings", "Materials match the specification", "Workmanship is acceptable", "Test records and sample approvals are available"]),
      { id: "outcome", title: "Outcome", fields: [pick("overall", "Overall result", ["Satisfactory", "Needs action", "Unsatisfactory"], { required: true }), long("comments", "Comments")] },
      table("actions", "Actions required", [t("action", "Action", { required: true }), t("responsible", "Responsible"), date("due", "Due date"), pick("status", "Status", ["Open", "In progress", "Closed"], { required: true })], { printRows: 6, track: { column: "status", closed: ["Closed"] } }),
    ],
  },

  // ----------------------------------------------------------------------------------------------------------- 3
  {
    code: "RFI", version: 1, name: "Request for Information (RFI)", prefix: "RFI", statuses: ["draft", "issued", "answered", "closed"],
    description: "Ask the designer or engineer a question about the drawings or specification, and record the answer.",
    sections: [
      { id: "details", title: "Request", fields: [
        t("to", "To (consultant / engineer)", { required: true }), t("cc", "Copy to"), pick("discipline", "Discipline", DISCIPLINES, { required: true }),
        t("subject", "Subject", { required: true }), pick("priority", "Priority", ["Normal", "Urgent", "Critical"]), date("date_required", "Answer needed by"),
        t("refs", "Drawing / specification references"),
      ] },
      { id: "question", title: "Question", fields: [long("question", "Question", { required: true }), long("proposal", "Contractor's proposed solution (if any)")] },
      { id: "impact", title: "Possible impact", fields: [pick("cost_impact", "Cost impact", ["None", "Possible", "Yes"]), num("cost_amount", "Estimated cost", { unit: "UGX" }), num("time_days", "Time impact", { unit: "days" })] },
      { id: "response", title: "Response", fields: [long("response", "Response", { requiredAt: "answered" }), t("responded_by", "Responded by", { requiredAt: "answered" }), date("response_date", "Date of response", { requiredAt: "answered" })] },
    ],
  },

  // ----------------------------------------------------------------------------------------------------------- 4
  {
    code: "CPC", version: 1, name: "Concrete Pour Checklist", prefix: "CPC", statuses: ["draft", "approved", "poured", "closed"],
    statusLabels: { approved: "Approved to pour", poured: "Poured", closed: "Closed (cubes recorded)" },
    description: "Checks before, during and after a concrete pour, with the delivery tickets, slump and cube records.",
    sections: [
      { id: "pour", title: "Pour details", fields: [
        t("element", "Element (e.g. ground floor slab)", { required: true }), t("location", "Location / grid", { required: true }), t("grade", "Concrete grade", { required: true }), t("mix", "Design mix"),
        num("planned_volume", "Planned volume", { unit: "m³", required: true }), t("supplier", "Concrete supplier"), date("pour_date", "Pour date", { required: true }),
        time("start_time", "Start"), time("end_time", "Finish"), t("engineer", "Engineer / consultant"),
      ] },
      checklist("pre", "Before the pour", ["Latest approved drawings are on site", "Formwork is to line, level and size, tight and braced", "Formwork is clean, oiled and free of debris", "Reinforcement size, spacing, laps and cover are as drawn", "Cover blocks / spacers are fixed", "Reinforcement is clean (no loose rust, oil or mud)", "Sleeves, conduits and embedded items are in place", "Construction joints and kickers are prepared and cleaned", "Grade, volume and delivery times are confirmed with the supplier", "Pump, vibrators, tools and enough labour are on site", "Weather protection is ready (rain cover / shade)", "Water for curing is available", "Engineer has inspected and approved the pour"], { requiredAt: "approved" }),
      checklist("during", "During the pour", ["Delivery ticket checked (grade and batching time)", "Slump test done and within limits", "Cube samples taken", "No water added on site", "Placed continuously, drop height 1.5 m or less", "Well compacted, no segregation or honeycombing", "Reinforcement and formwork not disturbed", "Concrete temperature acceptable"], { requiredAt: "poured" }),
      table("trucks", "Deliveries, slump and cubes", [t("ticket", "Ticket no.", { required: true }), time("time", "Time"), num("volume", "Volume (m³)"), num("slump", "Slump (mm)"), num("temp", "Temp (°C)"), num("cubes", "Cubes taken"), t("remarks", "Remarks")], { minRows: 1, requiredAt: "poured", printRows: 8 }),
      { id: "after", title: "After the pour", fields: [
        num("actual_volume", "Actual volume poured", { unit: "m³", requiredAt: "poured" }), pick("curing", "Curing method", ["Curing compound", "Wet hessian", "Ponding", "Plastic sheeting", "Other"], { requiredAt: "poured" }),
        date("striking_date", "Formwork striking date"), long("remarks", "Remarks"),
      ] },
      checklist("post", "After the pour", ["Surface finished and levelled to specification", "Curing has started", "Formwork striking date is set", "Cubes are labelled, stored and sent for 7 and 28 day tests", "Area and tools are cleaned", "Pour is recorded in the site diary"], { requiredAt: "closed" }),
      table("cube_results", "Cube test results", [t("cube", "Cube ref."), pick("age", "Age (days)", ["3", "7", "14", "28"]), num("strength", "Strength (MPa)"), date("tested", "Date tested"), yn("pass", "Meets the grade?")], { printRows: 6 }),
      { id: "signoff", title: "Sign-off", fields: [t("contractor", "Contractor's representative"), t("engineer_sign", "Engineer's name"), date("signoff_date", "Date")] },
    ],
  },

  // ----------------------------------------------------------------------------------------------------------- 5a
  {
    code: "DRV", version: 1, name: "Drawing Review Form", prefix: "DRV", statuses: ["draft", "submitted", "closed"],
    description: "Review drawings before construction: record each drawing's outcome and run the standard coordination checks.",
    sections: [
      { id: "details", title: "Review details", fields: [
        pick("type", "Type of review", ["Design review", "Shop drawing review", "Coordination review", "As-built check"], { required: true }), t("area", "Area / discipline"), t("reviewer", "Reviewer", { required: true }),
      ] },
      table("drawings", "Drawings reviewed", [t("number", "Drawing no.", { required: true }), t("title", "Title"), t("revision", "Rev."), pick("discipline", "Discipline", DISCIPLINES), pick("outcome", "Outcome", ["Approved", "Approved with comments", "Revise and resubmit", "Rejected", "For information"], { required: true }), t("comments", "Comments")], { minRows: 1, printRows: 10 }),
      checklist("checks", "Review checks", ["Drawing is the latest revision and issued for construction", "Dimensions and levels agree between plan, section and elevation", "Structural and architectural drawings are coordinated", "Services are coordinated, no clashes", "Materials and specification agree with the BOQ", "Reinforcement details are complete (sizes, spacing, laps, cover)", "Setting-out information and benchmarks are given", "Openings (doors, windows, sleeves) match the schedules", "Notes and legends are complete", "Approvals and permit references are shown"]),
      { id: "conclusion", title: "Conclusion", fields: [pick("overall", "Overall", ["Accepted", "Accepted with comments", "Not accepted"], { required: true }), long("comments", "Comments and follow-up")] },
    ],
  },

  // ----------------------------------------------------------------------------------------------------------- 5b
  {
    code: "SNG", version: 1, name: "Snag List", prefix: "SNG", statuses: ["draft", "issued", "closed"],
    statusLabels: { issued: "Issued to contractor", closed: "All snags closed" },
    description: "Defects found at inspection or handover, each with a location, responsible trade, priority and status.",
    sections: [
      { id: "details", title: "Snagging details", fields: [t("area", "Area / unit", { required: true }), t("inspected_by", "Inspected by", { required: true }), t("contractor", "Contractor"), date("target", "Completion target")] },
      table("snags", "Snags", [
        t("ref", "Ref."), t("location", "Location", { required: true }), t("description", "Defect", { required: true }),
        pick("category", "Category", ["Concrete", "Masonry", "Plaster", "Paint", "Floors / tiles", "Doors / windows", "Plumbing", "Electrical", "Roofing", "External works", "Other"]),
        t("trade", "Responsible"), pick("priority", "Priority", ["High", "Medium", "Low"]), date("found", "Found"), date("target", "Fix by"),
        pick("status", "Status", ["Open", "In progress", "Fixed - to verify", "Closed"], { required: true }), date("closed", "Closed on"), t("remarks", "Remarks"),
      ], { minRows: 1, requiredAt: "issued", printRows: 15, track: { column: "status", closed: ["Closed"] } }),
      { id: "acceptance", title: "Acceptance", fields: [long("comment", "Overall comment"), t("client_rep", "Client's representative"), t("contractor_rep", "Contractor's representative"), date("accepted_on", "Date")] },
    ],
  },

  // ----------------------------------------------------------------------------------------------------------- 6
  {
    code: "MDI", version: 1, name: "Material Delivery & Inspection Report", prefix: "MDI", statuses: ["draft", "submitted", "closed"],
    description: "Record what was delivered, check it against the order and specification, and accept or reject it.",
    sections: [
      { id: "delivery", title: "Delivery", fields: [
        t("supplier", "Supplier", { required: true }), t("delivery_note", "Delivery note no.", { required: true }), t("po", "Purchase order no."), time("arrival", "Arrival time"),
        t("vehicle", "Vehicle registration"), t("driver", "Driver"), t("received_by", "Received by", { required: true }), t("storage", "Stored at"),
      ] },
      table("materials", "Materials delivered", [
        t("material", "Material", { required: true }), t("spec", "Specification / grade / size"), num("ordered", "Ordered"), num("delivered", "Delivered", { required: true }), t("unit", "Unit", { required: true }),
        num("accepted", "Accepted", { required: true }), num("rejected", "Rejected"), pick("condition", "Condition", ["Good", "Damaged", "Wrong specification", "Short delivery", "Contaminated"], { required: true }), t("remarks", "Remarks"),
      ], { minRows: 1, printRows: 8 }),
      checklist("inspect", "Inspection", ["Delivery note matches the purchase order", "Quantities were counted and checked against the delivery note", "Material matches the specification (type, grade, size, brand)", "Packaging, labels and batch numbers are intact", "No visible damage, rust, moisture or contamination", "Test or mill certificates supplied where needed (steel, cement, aggregates)", "Within shelf life (cement, admixtures, adhesives)", "Samples taken for testing where required", "Stored correctly (off the ground, covered, dry)"]),
      { id: "outcome", title: "Outcome", fields: [pick("outcome", "Decision", ["Accepted", "Accepted with remarks", "Rejected"], { required: true }), long("action", "Action taken (e.g. returned to supplier, retest)"), t("supplier_rep", "Supplier's representative")] },
    ],
  },
];

export const TEMPLATE_BY_CODE = Object.fromEntries(TEMPLATES.map((x) => [x.code, x]));
