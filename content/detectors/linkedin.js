function scrapeLinkedIn() {
  const contacts = [];
  const path = window.location.pathname;

  // Single profile page (/in/username)
  if (path.startsWith("/in/")) {
    const name = qText([
      "h1.text-heading-xlarge",
      "h1[class*='inline']",
      "h1[class*='top-card-layout__title']",
      ".pv-top-card--list h1",
      "h1"
    ]);

    const title = qText([
      "div.text-body-medium",
      "[class*='headline']",
      "[class*='top-card-layout__headline']",
      ".pv-top-card--list .text-body-medium"
    ]);

    const location = qText([
      "[class*='top-card-layout__first-subline'] span",
      "[class*='top-card__subline-item']",
      "span[class*='location']",
      ".pv-top-card--list-bullet li:first-child"
    ]);

    const company = qText([
      "[class*='experience-item'] [class*='company']",
      "[aria-label*='Current company']",
      "[class*='pv-top-card--experience-list-item']",
      "button[aria-label*='company'] span"
    ]);

    const profileUrl = window.location.href.split("?")[0];
    const email = document.querySelector("a[href^='mailto:']")?.href?.replace("mailto:", "") || "";
    const phone = document.querySelector("a[href^='tel:']")?.href?.replace("tel:", "") || "";

    // Try to get about/summary
    const about = qText([
      "[class*='about'] [class*='inline-show-more-text']",
      "#about ~ div .inline-show-more-text",
      "[class*='summary'] [class*='text-body-medium']"
    ]).substring(0, 500);

    // Connection count
    const connections = qText([
      "[class*='distance-badge']",
      "span[class*='connections']",
      ".pv-top-card--list-bullet li:nth-child(2)"
    ]);

    contacts.push({
      name, title, company, location, email, phone,
      profileUrl, about, connections
    });
  }

  // Search results page
  else if (path.includes("/search/") || path.includes("/people")) {
    const cards = document.querySelectorAll([
      "[class*='entity-result__item']",
      "[class*='search-result__wrapper']",
      "[class*='reusable-search__result-container']",
      "li[class*='result']"
    ].join(", "));

    for (const card of cards) {
      const nameEl = card.querySelector([
        "[class*='entity-result__title-text'] a span[aria-hidden='true']",
        "[class*='entity-result__title'] a",
        "[class*='name'] a",
        "a[href*='/in/']"
      ].join(", "));

      const name = nameEl?.textContent?.trim() || "";
      const profileUrl = card.querySelector("a[href*='/in/']")?.href?.split("?")[0] || "";

      const title = cardText(card, [
        "[class*='entity-result__primary-subtitle']",
        "[class*='subline-level-1']"
      ]);

      const location = cardText(card, [
        "[class*='entity-result__secondary-subtitle']",
        "[class*='subline-level-2']"
      ]);

      if (name) {
        contacts.push({
          name, title, company: "", location,
          email: "", phone: "", profileUrl,
          about: "", connections: ""
        });
      }
    }
  }

  // Company page - list employees
  else if (path.includes("/company/")) {
    const companyName = qText([
      "h1[class*='org-top-card-summary__title']",
      "h1[class*='top-card-layout__title']",
      "h1"
    ]);

    const industry = qText([
      "[class*='org-top-card-summary-info-list__info-item']",
      "[class*='industry']"
    ]);

    const about = qText([
      "[class*='org-about-company-module__description']",
      "[class*='org-top-card-summary__tagline']"
    ]).substring(0, 500);

    contacts.push({
      name: companyName,
      title: "Company",
      company: industry,
      location: "",
      email: "",
      phone: "",
      profileUrl: window.location.href.split("?")[0],
      about,
      connections: ""
    });
  }

  return { type: "linkedin", contacts };
}

function qText(selectors) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim().replace(/\s+/g, " ");
        if (text) return text;
      }
    } catch (e) { /* skip */ }
  }
  return "";
}

function cardText(card, selectors) {
  for (const sel of selectors) {
    try {
      const el = card.querySelector(sel);
      if (el) {
        const text = el.textContent.trim().replace(/\s+/g, " ");
        if (text) return text;
      }
    } catch (e) { /* skip */ }
  }
  return "";
}
