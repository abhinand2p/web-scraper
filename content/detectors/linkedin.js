// LinkedIn scraper - uses page-level script injection to access Voyager API
// This is necessary because LinkedIn's JSESSIONID cookie is HttpOnly,
// so content scripts can't read it for the CSRF token.

async function scrapeLinkedIn() {
  const path = window.location.pathname;

  if (path.startsWith("/in/")) {
    const username = path.split("/in/")[1].split("/")[0].split("?")[0];
    return await scrapeProfileViaPageScript(username);
  }

  if (path.includes("/search/")) {
    return scrapeLinkedInSearchDOM();
  }

  if (path.includes("/company/")) {
    return scrapeLinkedInCompanyDOM();
  }

  return { type: "linkedin", contacts: [buildDOMProfile()] };
}

// --- Main profile scraping via page-level script injection ---

async function scrapeProfileViaPageScript(username) {
  return new Promise((resolve) => {
    // Listen for the result from the injected page script
    const handler = (event) => {
      if (event.detail && event.detail.__smartScraperResult) {
        document.removeEventListener("__smartScraperDone", handler);
        const result = event.detail.__smartScraperResult;
        resolve({ type: "linkedin", contacts: [result] });
      }
    };
    document.addEventListener("__smartScraperDone", handler);

    // Inject script into the page's MAIN world
    const script = document.createElement("script");
    script.textContent = `(${pageWorldScraper.toString()})("${username}")`;
    document.documentElement.appendChild(script);
    script.remove();

    // Timeout fallback - if page script fails, use DOM
    setTimeout(() => {
      document.removeEventListener("__smartScraperDone", handler);
      const domResult = buildDOMProfile();
      resolve({ type: "linkedin", contacts: [domResult] });
    }, 8000);
  });
}

// This function runs in the PAGE's world (not content script)
// It has access to cookies, LinkedIn's auth, and can fetch Voyager API
function pageWorldScraper(username) {
  // Get CSRF token from cookie (accessible in page world)
  function getCsrf() {
    const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
    return m ? m[1] : "";
  }

  async function apiFetch(url) {
    const csrf = getCsrf();
    if (!csrf) return null;
    try {
      const r = await fetch(url, {
        headers: {
          "csrf-token": csrf,
          "accept": "application/vnd.linkedin.normalized+json+2.1",
          "x-restli-protocol-version": "2.0.0"
        },
        credentials: "same-origin"
      });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  async function run() {
    const contact = {
      name: "", title: "", email: "", phone: "",
      company: "", location: "",
      profileUrl: "https://www.linkedin.com/in/" + username,
      about: "", connections: "",
      experience: [], education: [], skills: [],
      websites: [], twitter: "", birthday: ""
    };

    // Fetch all data in parallel
    const [profileResp, contactResp, skillsResp] = await Promise.all([
      apiFetch("https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=" + username + "&decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-93"),
      apiFetch("https://www.linkedin.com/voyager/api/identity/profiles/" + username + "/profileContactInfo"),
      apiFetch("https://www.linkedin.com/voyager/api/identity/profiles/" + username + "/skills?count=50")
    ]);

    // Parse profile
    if (profileResp && profileResp.included) {
      for (const e of profileResp.included) {
        const t = e["$type"] || "";

        // Main profile
        if (t.includes("profile.Profile") || t.includes("profile.FullProfile")) {
          if (e.firstName) contact.name = (e.firstName + " " + (e.lastName || "")).trim();
          if (e.headline) contact.title = e.headline;
          if (e.summary) contact.about = e.summary.substring(0, 1000);
          if (e.locationName) contact.location = e.locationName;
          if (e.geoLocationName) contact.location = e.geoLocationName;
          if (e.industryName) contact.industry = e.industryName;
        }

        // MiniProfile
        if (t.includes("MiniProfile") && !contact.name && e.firstName) {
          contact.name = (e.firstName + " " + (e.lastName || "")).trim();
          if (e.occupation) contact.title = e.occupation;
        }

        // Experience / Position
        if (t.includes("Position") && (e.title || e.companyName)) {
          var sd = e.dateRange ? e.dateRange.start : (e.timePeriod ? e.timePeriod.startDate : null);
          var ed = e.dateRange ? e.dateRange.end : (e.timePeriod ? e.timePeriod.endDate : null);
          contact.experience.push({
            title: e.title || "",
            company: e.companyName || "",
            location: e.locationName || "",
            startDate: sd ? ((sd.month || "") + (sd.month && sd.year ? "/" : "") + (sd.year || "")) : "",
            endDate: ed ? ((ed.month || "") + (ed.month && ed.year ? "/" : "") + (ed.year || "")) : "Present",
            description: (e.description || "").substring(0, 300)
          });
        }

        // Education
        if (t.includes("Education") && e.schoolName) {
          var esd = e.dateRange ? e.dateRange.start : (e.timePeriod ? e.timePeriod.startDate : null);
          var eed = e.dateRange ? e.dateRange.end : (e.timePeriod ? e.timePeriod.endDate : null);
          contact.education.push({
            school: e.schoolName || "",
            degree: e.degreeName || e.degree || "",
            field: e.fieldOfStudy || "",
            startDate: esd ? String(esd.year || "") : "",
            endDate: eed ? String(eed.year || "") : ""
          });
        }

        // Network info
        if (e.connectionsCount !== undefined || e.connectionCount !== undefined) {
          contact.connections = String(e.connectionsCount || e.connectionCount || "");
        }
      }

      // Set current company from experience
      if (contact.experience.length > 0) {
        var current = contact.experience.find(function(x) { return x.endDate === "Present"; }) || contact.experience[0];
        contact.company = current.company;
      }
    }

    // Parse contact info
    if (contactResp) {
      var ci = contactResp.data || contactResp;
      contact.email = ci.emailAddress || "";
      if (ci.phoneNumbers && ci.phoneNumbers.length) {
        contact.phone = ci.phoneNumbers.map(function(p) { return p.number; }).join(", ");
      }
      if (ci.twitterHandles && ci.twitterHandles.length) {
        contact.twitter = ci.twitterHandles.map(function(t) { return t.name; }).join(", ");
      }
      if (ci.websites && ci.websites.length) {
        contact.websites = ci.websites.map(function(w) { return w.url || ""; });
      }
      if (ci.birthDateOn) {
        contact.birthday = (ci.birthDateOn.month || "") + "/" + (ci.birthDateOn.day || "");
      }
    }

    // Parse skills
    if (skillsResp) {
      var elements = (skillsResp.data && skillsResp.data.elements) || skillsResp.elements || [];
      for (var i = 0; i < elements.length; i++) {
        var skillName = elements[i].name || (elements[i].skill && elements[i].skill.name) || "";
        if (skillName) contact.skills.push(skillName);
      }
      // Also try included array
      if (contact.skills.length === 0 && skillsResp.included) {
        for (var j = 0; j < skillsResp.included.length; j++) {
          var sk = skillsResp.included[j];
          if (sk.name && (sk["$type"] || "").includes("Skill")) {
            contact.skills.push(sk.name);
          }
        }
      }
    }

    // If name still empty, grab from DOM as last resort
    if (!contact.name) {
      var h1 = document.querySelector("h1");
      if (h1) contact.name = h1.textContent.trim();
    }

    // Dispatch result back to content script
    document.dispatchEvent(new CustomEvent("__smartScraperDone", {
      detail: { __smartScraperResult: contact }
    }));
  }

  run();
}

// --- DOM-based scrapers (for search results, company pages, and fallback) ---

function buildDOMProfile() {
  const name = domText("h1") || "";
  const title = domText(".text-body-medium.break-words, div.text-body-medium") || "";

  // Try to extract company from headline "Title at Company"
  let company = "";
  if (title.includes(" at ")) {
    company = title.split(" at ").slice(1).join(" at ").trim();
  } else if (title.includes(" @ ")) {
    company = title.split(" @ ").slice(1).join(" @ ").trim();
  }

  // Location
  const location = domText(
    "span.text-body-small.inline.t-black--light.break-words"
  ) || "";

  // About
  const about = domText(
    "#about ~ div .inline-show-more-text span[aria-hidden='true'], " +
    "#about + div + div span[aria-hidden='true']"
  ) || "";

  // Experience from DOM
  const experience = [];
  const expSection = document.querySelector("#experience");
  if (expSection) {
    const expContainer = expSection.closest("section") || expSection.parentElement?.parentElement;
    if (expContainer) {
      const expItems = expContainer.querySelectorAll("li.artdeco-list__item, li[class*='pvs-list__paged-list-item']");
      for (const item of expItems) {
        const spans = item.querySelectorAll("span[aria-hidden='true']");
        if (spans.length >= 2) {
          experience.push({
            title: spans[0]?.textContent?.trim() || "",
            company: spans[1]?.textContent?.trim() || "",
            location: spans[3]?.textContent?.trim() || "",
            startDate: "",
            endDate: "",
            description: ""
          });
        }
      }
    }
  }

  // Education from DOM
  const education = [];
  const eduSection = document.querySelector("#education");
  if (eduSection) {
    const eduContainer = eduSection.closest("section") || eduSection.parentElement?.parentElement;
    if (eduContainer) {
      const eduItems = eduContainer.querySelectorAll("li.artdeco-list__item, li[class*='pvs-list__paged-list-item']");
      for (const item of eduItems) {
        const spans = item.querySelectorAll("span[aria-hidden='true']");
        if (spans.length >= 1) {
          education.push({
            school: spans[0]?.textContent?.trim() || "",
            degree: spans[1]?.textContent?.trim() || "",
            field: "",
            startDate: "",
            endDate: ""
          });
        }
      }
    }
  }

  // Skills from DOM
  const skills = [];
  const skillsSection = document.querySelector("#skills");
  if (skillsSection) {
    const skillsContainer = skillsSection.closest("section") || skillsSection.parentElement?.parentElement;
    if (skillsContainer) {
      const skillItems = skillsContainer.querySelectorAll("span[aria-hidden='true']");
      for (const item of skillItems) {
        const text = item.textContent.trim();
        if (text && text.length < 60 && !text.includes("\n")) {
          skills.push(text);
        }
      }
    }
  }

  return {
    name, title, company, location,
    email: (() => {
      const el = document.querySelector('a[href^="mailto:"]');
      return el ? el.href.replace("mailto:", "").split("?")[0] : "";
    })(),
    phone: (() => {
      const el = document.querySelector('a[href^="tel:"]');
      return el ? el.href.replace("tel:", "") : "";
    })(),
    profileUrl: window.location.href.split("?")[0],
    about,
    connections: domText("span.t-bold:not(h1 span):not(h2 span)") || "",
    experience,
    education,
    skills,
    websites: [],
    twitter: "",
    birthday: ""
  };
}

function scrapeLinkedInSearchDOM() {
  const contacts = [];
  const containers = document.querySelectorAll(
    "li.reusable-search__result-container, " +
    "li[class*='search-result'], " +
    "div[class*='entity-result']"
  );

  for (const c of containers) {
    const nameEl = c.querySelector(
      "span[dir='ltr'] > span[aria-hidden='true'], " +
      "span[aria-hidden='true']"
    );
    const name = nameEl?.textContent?.trim()?.replace(/\s+/g, " ") || "";
    if (!name || name.length < 2) continue;

    const profileUrl = c.querySelector("a[href*='/in/']")?.href?.split("?")[0] || "";
    const title = searchText(c, ".entity-result__primary-subtitle, div[class*='entity-result__primary-subtitle']");
    const location = searchText(c, ".entity-result__secondary-subtitle, div[class*='entity-result__secondary-subtitle']");

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

function scrapeLinkedInCompanyDOM() {
  return {
    type: "linkedin",
    contacts: [{
      name: domText("h1 span, h1") || "",
      title: "Company",
      company: domText(".org-top-card-summary-info-list__info-item") || "",
      location: "",
      email: "", phone: "",
      profileUrl: window.location.href.split("?")[0],
      about: (domText("[class*='org-about'] p, .org-about-company-module__description") || "").substring(0, 500),
      connections: "",
      experience: [], education: [], skills: [],
      websites: [], twitter: "", birthday: ""
    }]
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

function searchText(container, selector) {
  try {
    const el = container.querySelector(selector);
    return el ? el.textContent.trim().replace(/\s+/g, " ") : "";
  } catch (e) { return ""; }
}
