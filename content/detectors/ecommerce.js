function scrapeEcommerce() {
  const products = [];

  // Strategy 1: JSON-LD structured data (most reliable)
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of jsonLdScripts) {
    try {
      let data = JSON.parse(script.textContent);
      // Handle @graph wrapper
      if (data["@graph"]) data = data["@graph"];
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const type = item["@type"];
        const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
        if (isProduct) {
          products.push({
            name: item.name || "",
            price: extractJsonLdPrice(item),
            currency: extractJsonLdCurrency(item),
            description: (item.description || "").substring(0, 500),
            image: typeof item.image === "string" ? item.image : (item.image?.[0]?.url || item.image?.[0] || ""),
            rating: item.aggregateRating?.ratingValue || "",
            reviewCount: item.aggregateRating?.reviewCount || "",
            availability: simplifyAvailability(item.offers?.availability || ""),
            brand: item.brand?.name || item.brand || "",
            sku: item.sku || ""
          });
        }
      }
    } catch (e) { /* skip malformed JSON-LD */ }
  }

  // Strategy 2: Microdata (itemprop attributes)
  if (products.length === 0) {
    const productElements = document.querySelectorAll('[itemtype*="schema.org/Product"]');
    for (const el of productElements) {
      products.push({
        name: getMicrodataProp(el, "name"),
        price: getMicrodataProp(el, "price") || getMicrodataContent(el, "price"),
        currency: getMicrodataContent(el, "priceCurrency"),
        description: getMicrodataProp(el, "description").substring(0, 500),
        image: el.querySelector('[itemprop="image"]')?.src || "",
        rating: getMicrodataContent(el, "ratingValue"),
        reviewCount: getMicrodataContent(el, "reviewCount"),
        availability: simplifyAvailability(getMicrodataContent(el, "availability")),
        brand: getMicrodataProp(el, "brand"),
        sku: getMicrodataProp(el, "sku")
      });
    }
  }

  // Strategy 3: Heuristic CSS/attribute matching (fallback)
  if (products.length === 0) {
    const name = queryFirstText([
      "#productTitle", "[data-testid='product-title']",
      "h1[class*='product']", "h1[class*='title']",
      "[class*='product-title']", "[class*='product-name']",
      "[class*='product_title']", "h1"
    ]) || document.title;

    const price = queryFirstText([
      "[class*='price-current']", "#priceblock_ourprice", "#priceblock_dealprice",
      "[data-testid='product-price']", "[class*='sale-price']", "[class*='actual-price']",
      "[class*='offer-price']", "[class*='product-price']", "[class*='Price']",
      "[itemprop='price']", "[data-price]", ".price"
    ]);

    const description = queryFirstText([
      "#productDescription", "[class*='product-description']",
      "[class*='product_description']", "[class*='description']"
    ]).substring(0, 500);

    const image = document.querySelector(
      "#landingImage, #imgBlkFront, [class*='product-image'] img, [class*='gallery'] img, [data-testid='product-image'] img"
    )?.src || "";

    const rating = queryFirstText([
      "[class*='rating'] [class*='value']", "[class*='star-rating']",
      "[data-testid='rating']", "[class*='review-rating']"
    ]);

    const availability = queryFirstText([
      "#availability", "[class*='availability']", "[class*='stock']",
      "[data-testid='availability']"
    ]);

    products.push({
      name, price, currency: "", description, image,
      rating, reviewCount: "", availability, brand: "", sku: ""
    });
  }

  return { type: "ecommerce", products };
}

function extractJsonLdPrice(item) {
  if (!item.offers) return "";
  const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
  return offers.price || offers.lowPrice || "";
}

function extractJsonLdCurrency(item) {
  if (!item.offers) return "";
  const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
  return offers.priceCurrency || "";
}

function getMicrodataProp(el, prop) {
  const node = el.querySelector(`[itemprop="${prop}"]`);
  return (node?.textContent || "").trim();
}

function getMicrodataContent(el, prop) {
  const node = el.querySelector(`[itemprop="${prop}"]`);
  return (node?.content || node?.textContent || "").trim();
}

function simplifyAvailability(val) {
  if (!val) return "";
  if (val.includes("InStock")) return "In Stock";
  if (val.includes("OutOfStock")) return "Out of Stock";
  if (val.includes("PreOrder")) return "Pre-Order";
  if (val.includes("LimitedAvailability")) return "Limited";
  return val;
}

function queryFirstText(selectors) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text) return text;
      }
    } catch (e) { /* invalid selector, skip */ }
  }
  return "";
}
