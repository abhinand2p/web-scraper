// Contact enrichment via third-party APIs
// Supported providers: Hunter.io, Apollo.io, Snov.io

async function enrichContact(contact, settings) {
  if (!settings || !settings.provider || !settings.apiKey) {
    return { error: "No API key configured. Click ⚙ Settings to add one." };
  }

  const { provider, apiKey } = settings;

  if (provider === "hunter") return enrichWithHunter(contact, apiKey);
  if (provider === "apollo") return enrichWithApollo(contact, apiKey);
  if (provider === "snov") return enrichWithSnov(contact, apiKey);

  return { error: "Unknown provider selected." };
}

// --- Hunter.io ---
// Docs: https://hunter.io/api-documentation/v2
async function enrichWithHunter(contact, apiKey) {
  const nameParts = (contact.name || "").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  if (!firstName) return { error: "No name available to search." };

  // Step 1: get domain from company name via Hunter domain search
  let domain = "";

  if (contact.websites && contact.websites.length > 0) {
    domain = extractDomain(contact.websites[0]);
  }

  if (!domain && contact.company) {
    try {
      const r = await fetch(
        `https://api.hunter.io/v2/domain-search?company=${encodeURIComponent(contact.company)}&api_key=${encodeURIComponent(apiKey)}&limit=1`
      );
      if (r.ok) {
        const d = await r.json();
        if (d.data && d.data.domain) domain = d.data.domain;
      }
    } catch (e) {}
  }

  if (!domain) {
    return { error: "Could not find company domain. Try adding a website to the LinkedIn profile, or switch to Apollo.io." };
  }

  // Step 2: find email
  try {
    const r = await fetch(
      `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${encodeURIComponent(apiKey)}`
    );
    const d = await r.json();

    if (d.data && d.data.email) {
      return {
        email: d.data.email,
        emailConfidence: d.data.score ? `${d.data.score}% confidence` : "",
        phone: ""
      };
    }

    if (d.errors && d.errors.length > 0) {
      return { error: "Hunter.io: " + (d.errors[0].details || d.errors[0].id) };
    }

    return { error: "No email found for this contact on Hunter.io." };
  } catch (e) {
    return { error: "Hunter.io request failed: " + e.message };
  }
}

// --- Apollo.io ---
// Docs: https://apolloio.github.io/apollo-api-docs/
async function enrichWithApollo(contact, apiKey) {
  const nameParts = (contact.name || "").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  if (!firstName) return { error: "No name available to search." };

  try {
    const body = {
      api_key: apiKey,
      first_name: firstName,
      last_name: lastName,
      organization_name: contact.company || "",
      linkedin_url: contact.profileUrl || ""
    };

    const r = await fetch("https://api.apollo.io/v1/people/match", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify(body)
    });

    const d = await r.json();

    if (d.person) {
      const p = d.person;
      const phones = (p.phone_numbers || [])
        .map(ph => ph.sanitized_number || ph.raw_number)
        .filter(Boolean);
      return {
        email: p.email || "",
        emailConfidence: "",
        phone: phones.join(", ") || ""
      };
    }

    if (d.error) return { error: "Apollo.io: " + d.error };
    if (!r.ok) return { error: `Apollo.io: HTTP ${r.status}` };

    return { error: "No match found in Apollo.io for this contact." };
  } catch (e) {
    return { error: "Apollo.io request failed: " + e.message };
  }
}

// --- Snov.io ---
// Docs: https://snov.io/api
async function enrichWithSnov(contact, apiKey) {
  const nameParts = (contact.name || "").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  if (!firstName) return { error: "No name available to search." };

  let domain = "";
  if (contact.websites && contact.websites.length > 0) {
    domain = extractDomain(contact.websites[0]);
  }
  if (!domain && contact.company) {
    // Snov.io doesn't have a domain lookup — best effort with company name as domain guess
    domain = contact.company.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";
  }

  if (!domain) return { error: "Cannot determine company domain for Snov.io." };

  try {
    // Get access token first
    const tokenResp = await fetch("https://api.snov.io/v1/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: apiKey, client_secret: "" })
    });

    if (!tokenResp.ok) return { error: "Snov.io: For Snov.io, enter your Client ID as the API key and Client Secret after a colon (e.g., id:secret)" };

    // If user passed "id:secret" format, split it
    let clientId = apiKey, clientSecret = "";
    if (apiKey.includes(":")) {
      [clientId, clientSecret] = apiKey.split(":");
    }

    const tokenResp2 = await fetch("https://api.snov.io/v1/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret })
    });

    const tokenData = await tokenResp2.json();
    if (!tokenData.access_token) return { error: "Snov.io: Could not authenticate. Check credentials." };

    const token = tokenData.access_token;

    // Find email by name + domain
    const emailResp = await fetch("https://api.snov.io/v2/email-finder", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ domain, firstName, lastName })
    });

    const emailData = await emailResp.json();

    if (emailData.email) {
      return { email: emailData.email, emailConfidence: "", phone: "" };
    }

    return { error: "No email found in Snov.io for this contact." };
  } catch (e) {
    return { error: "Snov.io request failed: " + e.message };
  }
}

// --- Helper ---
function extractDomain(url) {
  try {
    const u = new URL(url.startsWith("http") ? url : "https://" + url);
    return u.hostname.replace(/^www\./, "");
  } catch (e) {
    return "";
  }
}
