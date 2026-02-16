let scrapedData = null;
let currentTabId = null;

document.addEventListener("DOMContentLoaded", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;

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

  // Copyable fields
  const fields = [
    { label: "Name", value: contact.name },
    { label: "Designation", value: contact.title },
    { label: "Email", value: contact.email },
    { label: "Phone", value: contact.phone },
    { label: "Company", value: contact.company },
    { label: "Location", value: contact.location },
    { label: "Profile", value: contact.profileUrl }
  ];

  for (const field of fields) {
    const row = document.createElement("div");
    row.className = "contact-field";

    const label = document.createElement("span");
    label.className = "contact-field-label";
    label.textContent = field.label;

    const value = document.createElement("span");
    value.className = "contact-field-value" + (field.value ? "" : " empty");
    value.textContent = field.value || "N/A";

    row.appendChild(label);
    row.appendChild(value);

    if (field.value) {
      const copyBtn = document.createElement("button");
      copyBtn.className = "btn-copy";
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", () => copyToClipboard(field.value, copyBtn));
      row.appendChild(copyBtn);
    }

    card.appendChild(row);
  }

  // Copy All button
  const copyAllBtn = document.createElement("button");
  copyAllBtn.className = "btn-copy-all";
  copyAllBtn.textContent = "Copy All Info";
  copyAllBtn.addEventListener("click", () => {
    const allText = fields
      .filter(f => f.value)
      .map(f => `${f.label}: ${f.value}`)
      .join("\n");
    copyToClipboard(allText, copyAllBtn);
  });
  card.appendChild(copyAllBtn);

  return card;
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
    const headers = ["Name", "Title", "Company", "Location", "Email", "Phone", "Profile URL", "About", "Connections"];
    const rows = data.contacts.map(c => [
      c.name, c.title, c.company, c.location, c.email, c.phone,
      c.profileUrl, c.about, c.connections
    ]);
    return [headers, ...rows];
  }

  // General - export the most useful table-like data
  // If tables exist, export the first table
  if (data.tables && data.tables.length > 0) {
    const t = data.tables[0];
    if (t.headers.length > 0) {
      return [t.headers, ...t.rows];
    }
    return t.rows;
  }

  // Otherwise export links
  if (data.links && data.links.length > 0) {
    return [["Link Text", "URL"], ...data.links.map(l => [l.text, l.url])];
  }

  // Fallback: metadata + text
  const rows = [["Property", "Value"]];
  if (data.meta) {
    for (const [key, val] of Object.entries(data.meta)) {
      if (val) rows.push([key, val]);
    }
  }
  rows.push(["Content", (data.textContent || "").substring(0, 30000)]);
  return rows;
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
