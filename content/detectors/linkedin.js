// LinkedIn Voyager API scraper - fetches deep profile data using LinkedIn's internal API

async function scrapeLinkedIn() {
  const path = window.location.pathname;

  // Profile page
  if (path.startsWith("/in/")) {
    const username = path.split("/in/")[1].split("/")[0].split("?")[0];
    return await scrapeLinkedInProfile(username);
  }

  // Search results
  if (path.includes("/search/")) {
    return scrapeLinkedInSearchResults();
  }

  // Company page
  if (path.includes("/company/")) {
    return scrapeLinkedInCompany();
  }

  // Fallback to DOM scraping
  return { type: "linkedin", contacts: [scrapeLinkedInDOM()] };
}

// --- Voyager API Helpers ---

function getCSRFToken() {
  // LinkedIn stores CSRF token in JSESSIONID cookie (with quotes)
  const match = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
  return match ? match[1] : "";
}

async function voyagerFetch(url) {
  const csrf = getCSRFToken();
  if (!csrf) return null;

  try {
    const resp = await fetch(url, {
      headers: {
        "csrf-token": csrf,
        "accept": "application/vnd.linkedin.normalized+json+2.1",
        "x-restli-protocol-version": "2.0.0"
      },
      credentials: "include"
    });

    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}

// --- Profile Scraping via API ---

async function scrapeLinkedInProfile(username) {
  // Fetch profile, contact info, and skills in parallel
  const [profileData, contactData, skillsData] = await Promise.all([
    voyagerFetch(`https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${username}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-93`),
    voyagerFetch(`https://www.linkedin.com/voyager/api/identity/profiles/${username}/profileContactInfo`),
    voyagerFetch(`https://www.linkedin.com/voyager/api/identity/profiles/${username}/skills?count=50`)
  ]);

  const contact = {
    name: "",
    title: "",
    email: "",
    phone: "",
    company: "",
    location: "",
    profileUrl: `https://www.linkedin.com/in/${username}`,
    about: "",
    connections: "",
    experience: [],
    education: [],
    skills: [],
    websites: [],
    twitter: "",
    birthday: ""
  };

  // Parse profile data
  if (profileData) {
    const profile = extractProfile(profileData);
    contact.name = profile.name;
    contact.title = profile.headline;
    contact.location = profile.location;
    contact.about = profile.summary;
    contact.company = profile.currentCompany;
    contact.experience = profile.experience;
    contact.education = profile.education;
    contact.connections = profile.connectionCount;
  }

  // Parse contact info
  if (contactData && contactData.data) {
    const ci = contactData.data;
    contact.email = ci.emailAddress || "";
    contact.phone = (ci.phoneNumbers || []).map(p => p.number).join(", ");
    contact.twitter = (ci.twitterHandles || []).map(t => t.name).join(", ");
    contact.websites = (ci.websites || []).map(w => w.url || w.name || "");
    contact.birthday = ci.birthDateOn
      ? `${ci.birthDateOn.month}/${ci.birthDateOn.day}`
      : "";
  }

  // Parse skills
  if (skillsData) {
    contact.skills = extractSkills(skillsData);
  }

  // If API failed, fall back to DOM scraping
  if (!contact.name) {
    const domData = scrapeLinkedInDOM();
    Object.keys(domData).forEach(key => {
      if (domData[key] && !contact[key]) contact[key] = domData[key];
    });
  }

  return { type: "linkedin", contacts: [contact] };
}

function extractProfile(apiData) {
  const result = {
    name: "",
    headline: "",
    location: "",
    summary: "",
    currentCompany: "",
    connectionCount: "",
    experience: [],
    education: []
  };

  // The API returns data in 'included' array and 'data' object
  const included = apiData.included || [];
  const data = apiData.data || {};

  // Find the main profile entity
  for (const entity of included) {
    // Profile basics
    if (entity.$type === "com.linkedin.voyager.dash.identity.profile.Profile" ||
        entity.$type === "com.linkedin.voyager.identity.profile.Profile") {
      result.name = [entity.firstName, entity.lastName].filter(Boolean).join(" ");
      result.headline = entity.headline || "";
      result.summary = (entity.summary || entity.about || "").substring(0, 1000);
      if (entity.locationName) result.location = entity.locationName;
      if (entity.geoLocationName) result.location = entity.geoLocationName;
    }

    // Also check for miniProfile
    if (entity.$type === "com.linkedin.voyager.identity.shared.MiniProfile" ||
        entity.$type === "com.linkedin.voyager.dash.identity.profile.tetris.MiniProfile") {
      if (!result.name && entity.firstName) {
        result.name = [entity.firstName, entity.lastName].filter(Boolean).join(" ");
      }
      if (!result.headline && entity.occupation) {
        result.headline = entity.occupation;
      }
    }

    // Experience / positions
    if (entity.$type === "com.linkedin.voyager.dash.identity.profile.Position" ||
        entity.$type === "com.linkedin.voyager.identity.profile.Position") {
      const exp = {
        title: entity.title || "",
        company: entity.companyName || "",
        location: entity.locationName || "",
        startDate: formatLinkedInDate(entity.dateRange?.start || entity.timePeriod?.startDate),
        endDate: formatLinkedInDate(entity.dateRange?.end || entity.timePeriod?.endDate) || "Present",
        description: (entity.description || "").substring(0, 300)
      };
      if (exp.title || exp.company) {
        result.experience.push(exp);
      }
    }

    // Education
    if (entity.$type === "com.linkedin.voyager.dash.identity.profile.Education" ||
        entity.$type === "com.linkedin.voyager.identity.profile.Education") {
      const edu = {
        school: entity.schoolName || entity.school || "",
        degree: entity.degreeName || entity.degree || "",
        field: entity.fieldOfStudy || "",
        startDate: formatLinkedInDate(entity.dateRange?.start || entity.timePeriod?.startDate),
        endDate: formatLinkedInDate(entity.dateRange?.end || entity.timePeriod?.endDate)
      };
      if (edu.school) {
        result.education.push(edu);
      }
    }

    // Network info (connections count)
    if (entity.$type === "com.linkedin.voyager.dash.identity.profile.tetris.NetworkInfo" ||
        entity.connectionsCount !== undefined) {
      result.connectionCount = String(entity.connectionsCount || entity.connectionCount || "");
    }
  }

  // Extract company names from included entities for experience
  const companyMap = {};
  for (const entity of included) {
    if (entity.$type === "com.linkedin.voyager.dash.organization.Company" ||
        entity.$type === "com.linkedin.voyager.organization.Company") {
      if (entity.entityUrn && entity.name) {
        companyMap[entity.entityUrn] = entity.name;
      }
    }
  }

  // Fill in company names from references and find current company
  for (const exp of result.experience) {
    if (!exp.company) {
      // Try to resolve from company map
      for (const [urn, name] of Object.entries(companyMap)) {
        exp.company = name;
        break;
      }
    }
  }

  // Current company = first experience entry (most recent)
  if (result.experience.length > 0) {
    const current = result.experience.find(e => e.endDate === "Present") || result.experience[0];
    result.currentCompany = current.company;
  }

  return result;
}

function extractSkills(apiData) {
  const skills = [];
  const included = apiData.included || apiData.data || [];
  const elements = apiData.data?.elements || apiData.elements || [];

  // Try elements array first
  for (const el of elements) {
    const name = el.name || el.skill?.name || "";
    if (name) skills.push(name);
  }

  // Try included array
  if (skills.length === 0) {
    for (const entity of (Array.isArray(included) ? included : [])) {
      if (entity.$type === "com.linkedin.voyager.identity.profile.Skill" ||
          entity.$type === "com.linkedin.voyager.dash.identity.profile.Skill") {
        if (entity.name) skills.push(entity.name);
      }
    }
  }

  return skills;
}

function formatLinkedInDate(dateObj) {
  if (!dateObj) return "";
  const month = dateObj.month || "";
  const year = dateObj.year || "";
  if (month && year) return `${month}/${year}`;
  if (year) return String(year);
  return "";
}

// --- Search Results (DOM-based, API is heavily paginated) ---

function scrapeLinkedInSearchResults() {
  const contacts = [];

  const resultContainers = document.querySelectorAll(
    'li.reusable-search__result-container, ' +
    'div[data-view-name="search-entity-result-universal-template"], ' +
    'li[class*="search-result"], ' +
    'div[class*="entity-result"]'
  );

  for (const container of resultContainers) {
    const nameEl = container.querySelector(
      'span[dir="ltr"] > span[aria-hidden="true"], ' +
      'span[aria-hidden="true"]'
    );
    const name = nameEl?.textContent?.trim()?.replace(/\s+/g, " ") || "";
    if (!name || name.length < 2) continue;

    const profileLink = container.querySelector('a[href*="/in/"]');
    const profileUrl = profileLink?.href?.split("?")[0] || "";

    const title = getSearchText(container, [
      '.entity-result__primary-subtitle',
      'div[class*="entity-result__primary-subtitle"]'
    ]);

    const location = getSearchText(container, [
      '.entity-result__secondary-subtitle',
      'div[class*="entity-result__secondary-subtitle"]'
    ]);

    contacts.push({
      name, title, company: "", location,
      email: "", phone: "", profileUrl,
      about: "", connections: "",
      experience: [], education: [], skills: [],
      websites: [], twitter: "", birthday: ""
    });
  }

  return { type: "linkedin", contacts };
}

// --- Company Page (DOM-based) ---

function scrapeLinkedInCompany() {
  const companyName = domText("h1 span, h1") || "";
  const industry = domText(".org-top-card-summary-info-list__info-item") || "";
  const about = domText("[class*='org-about'] p, .org-about-company-module__description") || "";

  return {
    type: "linkedin",
    contacts: [{
      name: companyName,
      title: "Company",
      company: industry,
      location: "",
      email: "", phone: "",
      profileUrl: window.location.href.split("?")[0],
      about: about.substring(0, 500),
      connections: "",
      experience: [], education: [], skills: [],
      websites: [], twitter: "", birthday: ""
    }]
  };
}

// --- DOM Fallback ---

function scrapeLinkedInDOM() {
  return {
    name: domText("h1") || "",
    title: domText(".text-body-medium.break-words, div.text-body-medium") || "",
    email: (() => {
      const el = document.querySelector('a[href^="mailto:"]');
      return el ? el.href.replace("mailto:", "").split("?")[0] : "";
    })(),
    phone: (() => {
      const el = document.querySelector('a[href^="tel:"]');
      return el ? el.href.replace("tel:", "") : "";
    })(),
    company: "",
    location: "",
    profileUrl: window.location.href.split("?")[0],
    about: "",
    connections: "",
    experience: [],
    education: [],
    skills: [],
    websites: [],
    twitter: "",
    birthday: ""
  };
}

// --- Helpers ---

function domText(selector) {
  try {
    const el = document.querySelector(selector);
    if (!el) return "";
    const span = el.querySelector('span[aria-hidden="true"]');
    return (span || el).textContent.trim().replace(/\s+/g, " ");
  } catch (e) { return ""; }
}

function getSearchText(container, selectors) {
  for (const sel of selectors) {
    try {
      const el = container.querySelector(sel);
      if (el) {
        const text = el.textContent.trim().replace(/\s+/g, " ");
        if (text) return text;
      }
    } catch (e) {}
  }
  return "";
}
