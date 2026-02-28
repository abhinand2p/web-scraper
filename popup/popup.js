let scrapedData = null;
let currentTabId = null;
let enrichmentSettings = null; // { provider, apiKey }

document.addEventListener("DOMContentLoaded", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;

  // Load saved enrichment settings
  enrichmentSettings = await loadSettings();
  initSettingsPanel();

  // Check if we can access this page
  if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("about:") ||
      tab.url.startsWith("chrome-extension://") || tab.url.startsWith("edge://")) {
    showError("Cannot scrape this page. Chrome internal pages are restricted.");
    return;
  }

  // Inject content scripts
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        "utils/message-types.js",
        "content/detectors/ecommerce.js",
        "content/detectors/linkedin.js",
        "content/detectors/general.js",
        "content/content.js"
      ]
    });
  } catch (err) {
    showError("Cannot access this page. It may be restricted or require special permissions.");
    return;
  }

  // Detect site type
  chrome.tabs.sendMessage(tab.id, { type: MSG.DETECT_SITE_TYPE }, (response) => {
    if (chrome.runtime.lastError || !response) {
      showError("Could not communicate with the page. Try refreshing and clicking again.");
      return;
    }

    const siteType = response.siteType;
    showBadge(siteType);
    showOptions(siteType);
  });

  // Button handlers
  document.getElementById("btn-scrape").addEventListener("click", handleScrape);
  document.getElementById("btn-rescrape").addEventListener("click", handleScrape);
  document.getElementById("btn-pdf").addEventListener("click", exportPDF);
  document.getElementById("btn-excel").addEventListener("click", exportExcel);
  document.getElementById("btn-csv").addEventListener("click", exportCSV);
});

function handleScrape() {
  showSection("scraping-section");

  chrome.tabs.sendMessage(currentTabId, { type: MSG.SCRAPE_REQUEST }, (response) => {
    if (chrome.runtime.lastError || !response || !response.data) {
      showError("Scraping failed. The page structure may not be supported.");
      return;
    }

    scrapedData = response;
    showResults(response);
  });
}

// --- Settings Panel ---

function initSettingsPanel() {
  const btn = document.getElementById("btn-settings");
  const panel = document.getElementById("settings-section");
  const providerSelect = document.getElementById("provider-select");
  const apiKeyInput = document.getElementById("api-key-input");
  const saveBtn = document.getElementById("btn-save-settings");
  const clearBtn = document.getElementById("btn-clear-settings");
  const statusEl = document.getElementById("settings-status");

  // Populate from saved settings
  if (enrichmentSettings && enrichmentSettings.provider) {
    providerSelect.value = enrichmentSettings.provider;
    apiKeyInput.value = enrichmentSettings.apiKey || "";
  }
  updateProviderHint(providerSelect.value);

  // Toggle panel
  btn.addEventListener("click", () => {
    const isHidden = panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !isHidden);
    btn.classList.toggle("active", isHidden);
  });

  // Update hint on provider change
  providerSelect.addEventListener("change", () => updateProviderHint(providerSelect.value));

  // Save
  saveBtn.addEventListener("click", async () => {
    const provider = providerSelect.value;
    const apiKey = apiKeyInput.value.trim();

    if (!apiKey) {
      showSettingsStatus("Please enter an API key.", "error");
      return;
    }

    enrichmentSettings = { provider, apiKey };
    await chrome.storage.sync.set({ enrichmentSettings });
    showSettingsStatus("Saved!", "success");
    setTimeout(() => statusEl.classList.add("hidden"), 2000);
  });

  // Clear
  clearBtn.addEventListener("click", async () => {
    apiKeyInput.value = "";
    enrichmentSettings = null;
    await chrome.storage.sync.remove("enrichmentSettings");
    showSettingsStatus("API key cleared.", "success");
    setTimeout(() => statusEl.classList.add("hidden"), 2000);
  });
}

function updateProviderHint(provider) {
  const hints = {
    hunter: "Free tier: 25 requests/month. Sign up at hunter.io → Dashboard → API.",
    apollo: "Free tier: 50 exports/month. Sign up at apollo.io → Settings → Integrations → API.",
    snov: "Free tier: 50 credits/month. Sign up at snov.io → My Profile → API. Enter as clientId:clientSecret."
  };
  document.getElementById("provider-hint").textContent = hints[provider] || "";
}

function showSettingsStatus(msg, type) {
  const el = document.getElementById("settings-status");
  el.textContent = msg;
  el.className = "settings-status " + type;
  el.classList.remove("hidden");
}

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get("enrichmentSettings", (result) => {
      resolve(result.enrichmentSettings || null);
    });
  });
}

// --- UI Helpers ---

function showSection(id) {
  const sections = ["status-section", "error-section", "options-section", "scraping-section", "result-section"];
  for (const s of sections) {
    document.getElementById(s).classList.toggle("hidden", s !== id);
  }
}

function showError(msg) {
  document.getElementById("error-text").textContent = msg;
  showSection("error-section");
}

function showBadge(siteType) {
  const badge = document.getElementById("site-type-badge");
  badge.textContent = siteType;
  badge.className = `badge badge-${siteType}`;
  badge.classList.remove("hidden");
}

function showOptions(siteType) {
  const summaries = {
    ecommerce: "E-commerce page detected. Click to extract product data, prices, and details.",
    linkedin: "LinkedIn page detected. Click to extract contact and profile information.",
    general: "General page detected. Click to extract text, links, images, and tables."
  };

  document.getElementById("data-summary").textContent = summaries[siteType] || summaries.general;
  showSection("options-section");
}

function showResults(response) {
  const { siteType, data } = response;
  let summary = "";

  if (siteType === "ecommerce" && data.products) {
    const count = data.products.length;
    summary = `Found ${count} product${count !== 1 ? "s" : ""}. `;
    if (count > 0) {
      const p = data.products[0];
      summary += `First: "${p.name.substring(0, 60)}"`;
      if (p.price) summary += ` - ${p.currency ? p.currency + " " : ""}${p.price}`;
    }
  } else if (siteType === "linkedin" && data.contacts) {
    const count = data.contacts.length;
    summary = `Found ${count} contact${count !== 1 ? "s" : ""}. `;
    if (count > 0) {
      summary += `First: "${data.contacts[0].name}"`;
      if (data.contacts[0].title) summary += ` - ${data.contacts[0].title.substring(0, 50)}`;
    }
  } else {
    const parts = [];
    if (data.links?.length) parts.push(`${data.links.length} links`);
    if (data.images?.length) parts.push(`${data.images.length} images`);
    if (data.tables?.length) parts.push(`${data.tables.length} tables`);
    if (data.headings?.length) parts.push(`${data.headings.length} headings`);
    summary = `Extracted: ${parts.join(", ") || "page content"}.`;
  }

  document.getElementById("result-summary").textContent = summary;
  showSection("result-section");

  // Show contact cards for LinkedIn
  const contactCards = document.getElementById("contact-cards");
  const cardsList = document.getElementById("contact-cards-list");
  if (siteType === "linkedin" && data.contacts && data.contacts.length > 0) {
    cardsList.innerHTML = "";
    for (const contact of data.contacts) {
      cardsList.appendChild(buildContactCard(contact));
    }
    contactCards.classList.remove("hidden");
  } else {
    contactCards.classList.add("hidden");
  }
}

// --- LinkedIn Contact Cards ---

function buildContactCard(contact) {
  const card = document.createElement("div");
  card.className = "contact-card";

  // Name header
  const nameEl = document.createElement("div");
  nameEl.className = "contact-card-name";
  nameEl.textContent = contact.name || "Unknown";
  card.appendChild(nameEl);

  // Title / designation
  if (contact.title) {
    const titleEl = document.createElement("div");
    titleEl.className = "contact-card-title";
    titleEl.textContent = contact.title;
    card.appendChild(titleEl);
  }

  // Basic copyable fields
  const fields = [
    { label: "Name", value: contact.name },
    { label: "Designation", value: contact.title },
    { label: "Email", value: contact.email },
    { label: "Phone", value: contact.phone },
    { label: "Company", value: contact.company },
    { label: "Location", value: contact.location },
    { label: "Profile", value: contact.profileUrl },
    { label: "Twitter", value: contact.twitter },
    { label: "Websites", value: (contact.websites || []).join(", ") },
    { label: "Birthday", value: contact.birthday }
  ];

  for (const field of fields) {
    card.appendChild(buildField(field.label, field.value));
  }

  // Experience section
  if (contact.experience && contact.experience.length > 0) {
    card.appendChild(buildSection("Experience", contact.experience.map(exp =>
      `${exp.title}${exp.company ? " at " + exp.company : ""}${exp.startDate ? " (" + exp.startDate + " - " + (exp.endDate || "Present") + ")" : ""}`
    )));
  }

  // Education section
  if (contact.education && contact.education.length > 0) {
    card.appendChild(buildSection("Education", contact.education.map(edu =>
      `${edu.school}${edu.degree ? " - " + edu.degree : ""}${edu.field ? " (" + edu.field + ")" : ""}`
    )));
  }

  // Skills section
  if (contact.skills && contact.skills.length > 0) {
    card.appendChild(buildSection("Skills", [contact.skills.join(", ")]));
  }

  // About section
  if (contact.about) {
    card.appendChild(buildSection("About", [contact.about]));
  }

  // Copy All button
  const copyAllBtn = document.createElement("button");
  copyAllBtn.className = "btn-copy-all";
  copyAllBtn.textContent = "Copy All Info";
  copyAllBtn.addEventListener("click", () => {
    let allText = fields
      .filter(f => f.value)
      .map(f => `${f.label}: ${f.value}`)
      .join("\n");

    if (contact.experience?.length) {
      allText += "\n\nExperience:\n" + contact.experience.map(exp =>
        `- ${exp.title}${exp.company ? " at " + exp.company : ""}${exp.startDate ? " (" + exp.startDate + " - " + (exp.endDate || "Present") + ")" : ""}${exp.description ? "\n  " + exp.description : ""}`
      ).join("\n");
    }
    if (contact.education?.length) {
      allText += "\n\nEducation:\n" + contact.education.map(edu =>
        `- ${edu.school}${edu.degree ? " - " + edu.degree : ""}${edu.field ? " (" + edu.field + ")" : ""}`
      ).join("\n");
    }
    if (contact.skills?.length) {
      allText += "\n\nSkills: " + contact.skills.join(", ");
    }
    if (contact.about) {
      allText += "\n\nAbout: " + contact.about;
    }

    copyToClipboard(allText, copyAllBtn);
  });
  card.appendChild(copyAllBtn);

  // Enrich Contact button
  card.appendChild(buildEnrichButton(contact, card));

  return card;
}

function buildField(label, value) {
  const row = document.createElement("div");
  row.className = "contact-field";

  const labelEl = document.createElement("span");
  labelEl.className = "contact-field-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("span");
  valueEl.className = "contact-field-value" + (value ? "" : " empty");
  valueEl.textContent = value || "N/A";

  row.appendChild(labelEl);
  row.appendChild(valueEl);

  if (value) {
    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-copy";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => copyToClipboard(value, copyBtn));
    row.appendChild(copyBtn);
  }

  return row;
}

function buildEnrichButton(contact, card) {
  const wrapper = document.createElement("div");

  const enrichBtn = document.createElement("button");
  enrichBtn.className = "btn-enrich";

  const providerName = enrichmentSettings?.provider
    ? { hunter: "Hunter.io", apollo: "Apollo.io", snov: "Snov.io" }[enrichmentSettings.provider] || "API"
    : "API";

  enrichBtn.textContent = enrichmentSettings?.apiKey
    ? `Find Email/Phone via ${providerName}`
    : "Find Email/Phone (configure API key first)";

  const resultEl = document.createElement("div");
  resultEl.className = "enrich-result hidden";

  enrichBtn.addEventListener("click", async () => {
    if (!enrichmentSettings?.apiKey) {
      // Open settings panel
      document.getElementById("settings-section").classList.remove("hidden");
      document.getElementById("btn-settings").classList.add("active");
      document.getElementById("settings-section").scrollIntoView({ behavior: "smooth" });
      return;
    }

    enrichBtn.disabled = true;
    enrichBtn.textContent = "Searching...";
    resultEl.classList.add("hidden");

    const result = await enrichContact(contact, enrichmentSettings);

    enrichBtn.disabled = false;
    enrichBtn.textContent = `Find Email/Phone via ${providerName}`;
    resultEl.classList.remove("hidden");

    if (result.error) {
      resultEl.className = "enrich-result error";
      resultEl.textContent = result.error;
    } else {
      resultEl.className = "enrich-result";
      resultEl.innerHTML = "";

      if (result.email) {
        const emailRow = buildEnrichedField("Email", result.email, result.emailConfidence);
        resultEl.appendChild(emailRow);
      }
      if (result.phone) {
        const phoneRow = buildEnrichedField("Phone", result.phone, "");
        resultEl.appendChild(phoneRow);
      }
      if (!result.email && !result.phone) {
        resultEl.className = "enrich-result error";
        resultEl.textContent = "No contact info returned from API.";
      }
    }
  });

  wrapper.appendChild(enrichBtn);
  wrapper.appendChild(resultEl);
  return wrapper;
}

function buildEnrichedField(label, value, note) {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;";

  const left = document.createElement("span");
  left.innerHTML = `<strong>${label}</strong>${value}${note ? ` <span style="opacity:0.6;font-size:10px;">(${note})</span>` : ""}`;
  left.style.flex = "1";

  const copyBtn = document.createElement("button");
  copyBtn.className = "btn-copy";
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", () => copyToClipboard(value, copyBtn));

  row.appendChild(left);
  row.appendChild(copyBtn);
  return row;
}

function buildSection(title, items) {
  const section = document.createElement("div");
  section.className = "contact-section";

  const header = document.createElement("div");
  header.className = "contact-section-header";
  header.textContent = title;
  section.appendChild(header);

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "contact-section-item";
    row.textContent = item;
    section.appendChild(row);
  }

  return section;
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent;
    btn.textContent = "Copied!";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove("copied");
    }, 1500);
  });
}

// --- Data Flattening ---

function flattenDataToRows(response) {
  const { siteType, data } = response;

  if (siteType === "ecommerce" && data.products) {
    const headers = ["Name", "Price", "Currency", "Description", "Image URL", "Rating", "Reviews", "Availability", "Brand", "SKU"];
    const rows = data.products.map(p => [
      p.name, p.price, p.currency, p.description, p.image,
      p.rating, p.reviewCount, p.availability, p.brand, p.sku
    ]);
    return [headers, ...rows];
  }

  if (siteType === "linkedin" && data.contacts) {
    const headers = [
      "Name", "Title/Designation", "Company", "Location", "Email", "Phone",
      "Profile URL", "Twitter", "Websites", "Birthday", "Connections",
      "Experience", "Education", "Skills", "About"
    ];
    const rows = data.contacts.map(c => [
      c.name,
      c.title,
      c.company,
      c.location,
      c.email,
      c.phone,
      c.profileUrl,
      c.twitter || "",
      (c.websites || []).join(", "),
      c.birthday || "",
      c.connections,
      (c.experience || []).map(e => `${e.title} at ${e.company} (${e.startDate || ""} - ${e.endDate || "Present"})`).join("; "),
      (c.education || []).map(e => `${e.school}${e.degree ? " - " + e.degree : ""}${e.field ? " (" + e.field + ")" : ""}`).join("; "),
      (c.skills || []).join(", "),
      c.about
    ]);
    return [headers, ...rows];
  }

  // General - export structured data in order of usefulness
  const allRows = [];

  // Page metadata first
  allRows.push(["Page Info", ""]);
  if (data.meta) {
    if (data.meta.title) allRows.push(["Title", data.meta.title]);
    if (data.meta.url) allRows.push(["URL", data.meta.url]);
    if (data.meta.description) allRows.push(["Description", data.meta.description]);
    if (data.meta.author) allRows.push(["Author", data.meta.author]);
  }

  // If tables exist, include them (most structured data)
  if (data.tables && data.tables.length > 0) {
    allRows.push(["", ""]);
    allRows.push(["--- Tables ---", ""]);
    for (const t of data.tables) {
      if (t.headers.length > 0) {
        allRows.push(t.headers);
      }
      for (const row of t.rows) {
        allRows.push(row);
      }
      allRows.push(["", ""]); // separator
    }
  }

  // Headings for page structure
  if (data.headings && data.headings.length > 0) {
    allRows.push(["", ""]);
    allRows.push(["--- Page Structure ---", ""]);
    allRows.push(["Level", "Heading"]);
    for (const h of data.headings) {
      allRows.push([`H${h.level}`, h.text]);
    }
  }

  // Links
  if (data.links && data.links.length > 0) {
    allRows.push(["", ""]);
    allRows.push(["--- Links ---", ""]);
    allRows.push(["Link Text", "URL"]);
    for (const l of data.links) {
      allRows.push([l.text, l.url]);
    }
  }

  if (allRows.length <= 1) {
    allRows.push(["Content", (data.textContent || "").substring(0, 30000)]);
  }

  return allRows;
}

function generateFilename(extension) {
  const siteName = scrapedData?.data?.type || "scrape";
  const date = new Date().toISOString().slice(0, 10);
  return `${siteName}-${date}-${Date.now()}.${extension}`;
}

// --- Export Functions ---

function exportExcel() {
  if (!scrapedData) return;

  const rows = flattenDataToRows(scrapedData);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Auto-size columns (approximate)
  const colWidths = rows[0].map((_, colIdx) => {
    let maxLen = 10;
    for (const row of rows) {
      const cellLen = String(row[colIdx] || "").length;
      if (cellLen > maxLen) maxLen = Math.min(cellLen, 50);
    }
    return { wch: maxLen + 2 };
  });
  ws["!cols"] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, "Scraped Data");

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  downloadBlob(blob, generateFilename("xlsx"));
}

function exportCSV() {
  if (!scrapedData) return;

  const rows = flattenDataToRows(scrapedData);
  const csv = generateCSVString(rows);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }); // BOM for Excel UTF-8
  downloadBlob(blob, generateFilename("csv"));
}

function exportPDF() {
  if (!scrapedData) return;

  const iframe = document.getElementById("sandbox-frame");
  const rows = flattenDataToRows(scrapedData);

  const handler = (event) => {
    if (event.data?.type !== "PDF_READY") return;
    window.removeEventListener("message", handler);

    // Convert base64 data URI to blob
    const base64 = event.data.pdfDataUri.split(",")[1];
    const byteChars = atob(base64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }
    const blob = new Blob([byteArray], { type: "application/pdf" });
    downloadBlob(blob, generateFilename("pdf"));
  };

  window.addEventListener("message", handler);

  iframe.contentWindow.postMessage({
    type: "GENERATE_PDF",
    payload: {
      siteType: scrapedData.siteType,
      pageTitle: scrapedData.pageTitle || "",
      url: scrapedData.url || "",
      timestamp: scrapedData.timestamp || "",
      rows
    }
  }, "*");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url,
    filename,
    saveAs: true
  }, () => {
    // Clean up object URL after download starts
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
}
