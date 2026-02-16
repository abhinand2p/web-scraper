function scrapeGeneral() {
  // Page metadata
  const meta = {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content || "",
    keywords: document.querySelector('meta[name="keywords"]')?.content || "",
    ogTitle: document.querySelector('meta[property="og:title"]')?.content || "",
    ogDescription: document.querySelector('meta[property="og:description"]')?.content || "",
    author: document.querySelector('meta[name="author"]')?.content || "",
    url: window.location.href
  };

  // Main text content (truncated to prevent huge payloads)
  const textContent = (document.body?.innerText || "").substring(0, 50000);

  // All links
  const seenUrls = new Set();
  const links = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const url = a.href;
    if (url && url.startsWith("http") && !seenUrls.has(url)) {
      seenUrls.add(url);
      links.push({
        text: a.textContent.trim().replace(/\s+/g, " ").substring(0, 200),
        url
      });
    }
    if (links.length >= 500) break;
  }

  // All images with src
  const images = [];
  const seenSrcs = new Set();
  for (const img of document.querySelectorAll("img[src]")) {
    const src = img.src;
    if (src && src.startsWith("http") && !seenSrcs.has(src)) {
      seenSrcs.add(src);
      images.push({
        alt: img.alt || "",
        src,
        width: img.naturalWidth || 0,
        height: img.naturalHeight || 0
      });
    }
    if (images.length >= 200) break;
  }

  // All tables
  const tables = [];
  const tableEls = document.querySelectorAll("table");
  for (let i = 0; i < Math.min(tableEls.length, 20); i++) {
    const table = tableEls[i];
    const headers = Array.from(table.querySelectorAll("thead th, tr:first-child th"))
      .map(th => th.textContent.trim().replace(/\s+/g, " "));

    const rows = [];
    const bodyRows = table.querySelectorAll("tbody tr");
    const allRows = bodyRows.length > 0 ? bodyRows : table.querySelectorAll("tr");
    for (const tr of allRows) {
      const cells = Array.from(tr.querySelectorAll("td"))
        .map(td => td.textContent.trim().replace(/\s+/g, " "));
      if (cells.length > 0) rows.push(cells);
      if (rows.length >= 100) break;
    }

    if (headers.length > 0 || rows.length > 0) {
      tables.push({ index: i, headers, rows });
    }
  }

  // Headings structure
  const headings = [];
  for (const h of document.querySelectorAll("h1, h2, h3, h4")) {
    const text = h.textContent.trim().replace(/\s+/g, " ");
    if (text) {
      headings.push({ level: parseInt(h.tagName[1]), text: text.substring(0, 200) });
    }
    if (headings.length >= 50) break;
  }

  return {
    type: "general",
    meta,
    headings,
    textContent,
    links,
    images,
    tables
  };
}
