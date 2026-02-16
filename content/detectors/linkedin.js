function scrapeLinkedIn() {
  const contacts = [];
  const path = window.location.pathname;

  // Single profile page (/in/username)
  if (path.startsWith("/in/")) {
    // Name - LinkedIn always has this in h1
    const name = getLinkedInText([
      "h1",
      "[data-anonymize='person-name']"
    ]);

    // Headline / designation - the line right below the name
    const title = getLinkedInText([
      ".text-body-medium.break-words",
      "div.text-body-medium",
      "[data-anonymize='headline']",
      "h2.top-card-layout__headline"
    ]);

    // Location
    const location = getLinkedInText([
      ".top-card-layout__first-subline .top-card__subline-item",
      "span.text-body-small[class*='top-card']",
      "[class*='top-card'] span[class*='location']"
    ]) || getLocationFromProfile();

    // Current company - try multiple approaches
    const company = getCurrentCompany();

    const profileUrl = window.location.href.split("?")[0];

    // Email & phone - only visible if contact info section is open
    const email = getEmailFromPage();
    const phone = getPhoneFromPage();

    // About section
    const about = getLinkedInText([
      "#about ~ div .inline-show-more-text span[aria-hidden='true']",
      "#about + .pvs-list__container .inline-show-more-text span[aria-hidden='true']",
      "[class*='about'] .inline-show-more-text span[aria-hidden='true']",
      "section.pv-about-section p",
      "#about ~ div span.visually-hidden"
    ]).substring(0, 500);

    // Connections
    const connections = getLinkedInText([
      "span.t-bold[class*='distance']",
      "li.text-body-small span.t-bold",
      "[class*='connections'] span.t-bold"
    ]);

    contacts.push({
      name, title, company, location, email, phone,
      profileUrl, about, connections
    });
  }

  // Search results or people listing
  else if (path.includes("/search/") || path.includes("/people")) {
    // LinkedIn search results use list items
    const resultContainers = document.querySelectorAll(
      'li.reusable-search__result-container, ' +
      'div[data-view-name="search-entity-result-universal-template"], ' +
      'li[class*="search-result"], ' +
      'div[class*="entity-result"]'
    );

    for (const container of resultContainers) {
      const nameEl = container.querySelector(
        'span[dir="ltr"] > span[aria-hidden="true"], ' +
        'span[aria-hidden="true"], ' +
        'a[class*="app-aware-link"] span'
      );
      const name = nameEl?.textContent?.trim()?.replace(/\s+/g, " ") || "";
      if (!name || name.length < 2) continue;

      const profileLink = container.querySelector('a[href*="/in/"]');
      const profileUrl = profileLink?.href?.split("?")[0] || "";

      const title = getContainerText(container, [
        '.entity-result__primary-subtitle',
        'div[class*="entity-result__primary-subtitle"]',
        '.search-result__info .subline-level-1'
      ]);

      const location = getContainerText(container, [
        '.entity-result__secondary-subtitle',
        'div[class*="entity-result__secondary-subtitle"]',
        '.search-result__info .subline-level-2'
      ]);

      contacts.push({
        name, title, company: "", location,
        email: "", phone: "", profileUrl,
        about: "", connections: ""
      });
    }
  }

  // Company page
  else if (path.includes("/company/")) {
    const companyName = getLinkedInText([
      "h1 span",
      "h1",
      ".org-top-card-summary__title span"
    ]);

    const industry = getLinkedInText([
      ".org-top-card-summary-info-list__info-item",
      "div[class*='org-top-card'] [class*='info-item']"
    ]);

    const about = getLinkedInText([
      "[class*='org-about'] p",
      ".org-about-company-module__description",
      "p[class*='about']"
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

// --- LinkedIn Helper Functions ---

function getLinkedInText(selectors) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        // Prefer aria-hidden span (visible text without screen reader content)
        const visibleSpan = el.querySelector('span[aria-hidden="true"]');
        const textSource = visibleSpan || el;
        const text = textSource.textContent.trim().replace(/\s+/g, " ");
        if (text && text.length > 0) return text;
      }
    } catch (e) { /* skip */ }
  }
  return "";
}

function getContainerText(container, selectors) {
  for (const sel of selectors) {
    try {
      const el = container.querySelector(sel);
      if (el) {
        const text = el.textContent.trim().replace(/\s+/g, " ");
        if (text) return text;
      }
    } catch (e) { /* skip */ }
  }
  return "";
}

function getCurrentCompany() {
  // Method 1: Experience section - first/current role
  const expSection = document.querySelector('#experience ~ div, #experience ~ .pvs-list__container, section[id*="experience"]');
  if (expSection) {
    const firstItem = expSection.querySelector(
      'span[aria-hidden="true"], .t-bold span, [class*="company"] span'
    );
    if (firstItem) {
      const text = firstItem.textContent.trim().replace(/\s+/g, " ");
      if (text) return text;
    }
  }

  // Method 2: Top card experience info
  const topCardExp = document.querySelector(
    '[class*="experience-list-item"] span, ' +
    'button[aria-label*="Current company"] span, ' +
    '[class*="pv-top-card--experience"] li span'
  );
  if (topCardExp) {
    const text = topCardExp.textContent.trim().replace(/\s+/g, " ");
    if (text) return text;
  }

  // Method 3: Look for company in headline (often "Title at Company")
  const headline = getLinkedInText([
    ".text-body-medium.break-words",
    "div.text-body-medium"
  ]);
  if (headline.includes(" at ")) {
    return headline.split(" at ").slice(1).join(" at ").trim();
  }
  if (headline.includes(" @ ")) {
    return headline.split(" @ ").slice(1).join(" @ ").trim();
  }

  return "";
}

function getLocationFromProfile() {
  // Location is often in a specific span within the top card
  const spans = document.querySelectorAll('.pv-top-card--list-bullet li, [class*="top-card"] li');
  for (const span of spans) {
    const text = span.textContent.trim();
    // Location typically contains a comma (City, State) or known location words
    if (text && (text.includes(",") || text.match(/\b(area|region|city|state|country)\b/i))) {
      return text;
    }
  }
  return "";
}

function getEmailFromPage() {
  // Check for mailto links anywhere on the page
  const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
  for (const link of mailtoLinks) {
    const email = link.href.replace("mailto:", "").split("?")[0].trim();
    if (email && email.includes("@")) return email;
  }

  // Check contact info section if open
  const contactSection = document.querySelector(
    '[class*="contact-info"], [class*="pv-contact-info"], ' +
    'section[class*="ci-email"], [data-section="contactInfo"]'
  );
  if (contactSection) {
    const emailEl = contactSection.querySelector('a[href*="mailto:"], [class*="email"] a');
    if (emailEl) return emailEl.textContent.trim();
  }

  return "";
}

function getPhoneFromPage() {
  // Check for tel links
  const telLinks = document.querySelectorAll('a[href^="tel:"]');
  for (const link of telLinks) {
    const phone = link.href.replace("tel:", "").trim();
    if (phone) return phone;
  }

  // Check contact info section
  const contactSection = document.querySelector(
    '[class*="contact-info"], [class*="pv-contact-info"], [data-section="contactInfo"]'
  );
  if (contactSection) {
    const phoneEl = contactSection.querySelector('[class*="phone"] span, [class*="tel"] span');
    if (phoneEl) return phoneEl.textContent.trim();
  }

  return "";
}
