// Guard against duplicate injection
if (window.__smartScraperInjected) {
  // Already injected, skip
} else {
  window.__smartScraperInjected = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === MSG.DETECT_SITE_TYPE) {
      const siteType = detectSiteType();
      sendResponse({ siteType });
      return true;
    }

    if (message.type === MSG.SCRAPE_REQUEST) {
      const siteType = message.siteType || detectSiteType();

      // Use async handler to support API-based scrapers
      (async () => {
        try {
          let data;
          switch (siteType) {
            case "ecommerce":
              data = scrapeEcommerce();
              break;
            case "linkedin":
              data = await scrapeLinkedIn();
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
        } catch (err) {
          sendResponse({
            siteType,
            data: null,
            error: err.message,
            url: window.location.href,
            pageTitle: document.title,
            timestamp: new Date().toISOString()
          });
        }
      })();

      return true; // Keep message channel open for async response
    }
  });
}

function detectSiteType() {
  const hostname = window.location.hostname.toLowerCase();
  const url = window.location.href.toLowerCase();

  // LinkedIn detection
  if (hostname.includes("linkedin.com")) return "linkedin";

  // Known e-commerce domains
  const knownEcommerce = [
    "amazon", "ebay", "shopify", "etsy", "walmart", "aliexpress",
    "bestbuy", "target", "wayfair", "newegg", "homedepot",
    "costco", "macys", "nordstrom", "zappos", "overstock",
    "wish.com", "shein", "flipkart", "myntra", "lazada",
    "asos", "zara", "hm.com", "uniqlo", "nike", "adidas"
  ];
  if (knownEcommerce.some(s => hostname.includes(s))) return "ecommerce";

  // Check for JSON-LD Product schema
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of jsonLdScripts) {
    try {
      const text = script.textContent;
      if (text.includes('"Product"') || text.includes('"@type":"Product"') || text.includes('"@type": "Product"')) {
        return "ecommerce";
      }
    } catch (e) { /* skip */ }
  }

  // Check for microdata product markup
  if (document.querySelector('[itemtype*="schema.org/Product"], [itemtype*="schema.org/product"]')) {
    return "ecommerce";
  }

  // Check for Open Graph product type
  const ogType = document.querySelector('meta[property="og:type"]')?.content?.toLowerCase();
  if (ogType && (ogType.includes("product") || ogType === "og:product")) {
    return "ecommerce";
  }

  // Broad heuristic: look for price patterns + product indicators on the page
  const bodyHTML = document.body?.innerHTML || "";
  const hasPrice = !!document.querySelector(
    '[class*="price"], [id*="price"], [data-price], [itemprop="price"]'
  );
  const hasAddToCart = !!document.querySelector(
    '[class*="add-to-cart"], [class*="add_to_cart"], [class*="addToCart"], [class*="add-to-bag"], ' +
    '[id*="add-to-cart"], [id*="addToCart"], button[name="add"], ' +
    '[data-action*="cart"], [data-action*="add"], [class*="buy-now"], [class*="buyNow"]'
  );
  const hasCurrencySymbol = /[\$\€\£\¥\₹]\s?\d/.test(document.body?.innerText?.substring(0, 5000) || "");

  // Shopify/WooCommerce detection
  const isShopify = bodyHTML.includes("Shopify.") || bodyHTML.includes("shopify") ||
    !!document.querySelector('meta[name="shopify-checkout-api-token"], link[href*="cdn.shopify"]');
  const isWooCommerce = !!document.querySelector(
    'body.woocommerce, .woocommerce-page, meta[name="generator"][content*="WooCommerce"]'
  );

  if (isShopify || isWooCommerce) return "ecommerce";
  if (hasPrice && hasAddToCart) return "ecommerce";
  if (hasPrice && hasCurrencySymbol && (hasAddToCart || document.querySelector('[class*="product"]'))) return "ecommerce";

  return "general";
}
