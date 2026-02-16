// Main content script - orchestrates site detection and scraping

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.DETECT_SITE_TYPE) {
    const siteType = detectSiteType();
    sendResponse({ siteType });
    return true;
  }

  if (message.type === MSG.SCRAPE_REQUEST) {
    const siteType = message.siteType || detectSiteType();
    let data;

    switch (siteType) {
      case "ecommerce":
        data = scrapeEcommerce();
        break;
      case "linkedin":
        data = scrapeLinkedIn();
        break;
      default:
        data = scrapeGeneral();
        break;
    }

    sendResponse({
      siteType,
      data,
      url: window.location.href,
      pageTitle: document.title,
      timestamp: new Date().toISOString()
    });
    return true;
  }
});

function detectSiteType() {
  const hostname = window.location.hostname.toLowerCase();

  // LinkedIn detection
  if (hostname.includes("linkedin.com")) return "linkedin";

  // E-commerce detection
  const knownEcommerce = [
    "amazon", "ebay", "shopify", "etsy", "walmart", "aliexpress",
    "bestbuy", "target", "wayfair", "newegg", "homedepot",
    "costco", "macys", "nordstrom", "zappos", "overstock",
    "wish.com", "shein", "flipkart", "myntra", "lazada"
  ];

  if (knownEcommerce.some(s => hostname.includes(s))) return "ecommerce";

  // Check for product-related structured data
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of jsonLdScripts) {
    try {
      let data = JSON.parse(script.textContent);
      if (data["@graph"]) data = data["@graph"];
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const type = item["@type"];
        if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) {
          return "ecommerce";
        }
      }
    } catch (e) { /* skip */ }
  }

  // Check for microdata product markup
  if (document.querySelector('[itemtype*="schema.org/Product"]')) return "ecommerce";

  // Check for common e-commerce DOM patterns
  const hasPriceEl = !!document.querySelector(
    '[class*="price"][class*="product"], [data-price], [itemprop="price"]'
  );
  const hasCartEl = !!document.querySelector(
    '[class*="add-to-cart"], [class*="add_to_cart"], [data-action*="cart"], button[name="add"]'
  );
  if (hasPriceEl && hasCartEl) return "ecommerce";

  return "general";
}
