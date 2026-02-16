function scrapeEcommerce() {
  const products = [];

  // Strategy 1: JSON-LD structured data (most reliable)
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of jsonLdScripts) {
    try {
      let data = JSON.parse(script.textContent);
      extractProductsFromJsonLd(data, products);
    } catch (e) { /* skip malformed JSON-LD */ }
  }

  // Strategy 2: Microdata (itemprop attributes)
  if (products.length === 0) {
    const productElements = document.querySelectorAll('[itemtype*="schema.org/Product"], [itemtype*="schema.org/product"]');
    for (const el of productElements) {
      products.push({
        name: getMicrodataProp(el, "name"),
        price: getMicrodataContent(el, "price") || getMicrodataProp(el, "price"),
        currency: getMicrodataContent(el, "priceCurrency"),
        description: getMicrodataProp(el, "description").substring(0, 500),
        image: el.querySelector('[itemprop="image"]')?.src || el.querySelector('[itemprop="image"]')?.content || "",
        rating: getMicrodataContent(el, "ratingValue"),
        reviewCount: getMicrodataContent(el, "reviewCount"),
        availability: simplifyAvailability(getMicrodataContent(el, "availability")),
        brand: getMicrodataProp(el, "brand"),
        sku: getMicrodataProp(el, "sku")
      });
    }
  }

  // Strategy 3: Platform-specific scrapers
  if (products.length === 0) {
    const hostname = window.location.hostname.toLowerCase();

    if (hostname.includes("amazon")) {
      products.push(scrapeAmazon());
    } else if (document.querySelector('meta[name="shopify-checkout-api-token"], link[href*="cdn.shopify"]') ||
               document.body?.innerHTML?.includes("Shopify.")) {
      products.push(scrapeShopify());
    } else if (document.querySelector('body.woocommerce, .woocommerce-page')) {
      products.push(scrapeWooCommerce());
    } else {
      // Generic heuristic fallback
      products.push(scrapeGenericProduct());
    }
  }

  // Filter out empty entries
  const filtered = products.filter(p => p.name && p.name !== document.title.split("|")[0]?.trim() || p.price);

  return { type: "ecommerce", products: filtered.length > 0 ? filtered : products };
}

function extractProductsFromJsonLd(data, products) {
  if (!data) return;

  // Handle @graph wrapper
  if (data["@graph"]) {
    for (const item of data["@graph"]) {
      extractProductsFromJsonLd(item, products);
    }
    return;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    for (const item of data) {
      extractProductsFromJsonLd(item, products);
    }
    return;
  }

  const type = data["@type"];
  const isProduct = type === "Product" ||
    (Array.isArray(type) && type.includes("Product")) ||
    type === "IndividualProduct";

  if (isProduct) {
    const offers = data.offers;
    let price = "";
    let currency = "";

    if (offers) {
      if (Array.isArray(offers)) {
        price = offers[0]?.price || offers[0]?.lowPrice || "";
        currency = offers[0]?.priceCurrency || "";
      } else if (offers["@type"] === "AggregateOffer") {
        price = offers.lowPrice || offers.highPrice || "";
        currency = offers.priceCurrency || "";
      } else {
        price = offers.price || offers.lowPrice || "";
        currency = offers.priceCurrency || "";
      }
    }

    // Handle image which can be string, array, or object
    let image = "";
    if (typeof data.image === "string") {
      image = data.image;
    } else if (Array.isArray(data.image)) {
      image = typeof data.image[0] === "string" ? data.image[0] : (data.image[0]?.url || "");
    } else if (data.image?.url) {
      image = data.image.url;
    }

    products.push({
      name: data.name || "",
      price: String(price),
      currency: currency,
      description: (data.description || "").replace(/<[^>]*>/g, "").substring(0, 500),
      image: image,
      rating: String(data.aggregateRating?.ratingValue || ""),
      reviewCount: String(data.aggregateRating?.reviewCount || data.aggregateRating?.ratingCount || ""),
      availability: simplifyAvailability(
        (Array.isArray(offers) ? offers[0]?.availability : offers?.availability) || ""
      ),
      brand: data.brand?.name || (typeof data.brand === "string" ? data.brand : ""),
      sku: data.sku || data.mpn || ""
    });
  }
}

// --- Platform-specific scrapers ---

function scrapeAmazon() {
  return {
    name: getText("#productTitle") || getText("#title") || document.title,
    price: getText(".a-price .a-offscreen") || getText("#priceblock_ourprice") ||
           getText("#priceblock_dealprice") || getText(".a-price-whole") ||
           getText("#corePrice_feature_div .a-offscreen") ||
           getText("#corePriceDisplay_desktop_feature_div .a-offscreen") || "",
    currency: "",
    description: getText("#productDescription p") ||
                 getText("#feature-bullets .a-list-item") || "",
    image: document.querySelector("#landingImage, #imgBlkFront, #main-image, #ebooksImgBlkFront")?.src || "",
    rating: getText("#acrPopover .a-icon-alt")?.replace(/\s*out of.*/, "") || "",
    reviewCount: getText("#acrCustomerReviewText")?.replace(/[^\d,]/g, "") || "",
    availability: getText("#availability span") || "",
    brand: getText("#bylineInfo") || getText("a#brand") || "",
    sku: getText("#productDetails_detailBullets_sections1 td")?.trim() || ""
  };
}

function scrapeShopify() {
  // Try Shopify's global product JSON first
  let productData = null;
  try {
    const metaEl = document.querySelector('script[type="application/json"][data-product-json], #ProductJson-product-template');
    if (metaEl) productData = JSON.parse(metaEl.textContent);
  } catch (e) {}

  // Try window.ShopifyAnalytics or meta tags
  const price = productData?.price ?
    (productData.price / 100).toFixed(2) :
    getText('[class*="price"] [class*="money"], [class*="price-item"], .product__price, [data-product-price]') || "";

  return {
    name: productData?.title || getText('h1[class*="product"], h1[class*="title"], .product-single__title, .product__title, h1') || "",
    price: price,
    currency: document.querySelector('meta[itemprop="priceCurrency"]')?.content || "",
    description: getText('[class*="product-description"], [class*="product__description"], .product-single__description, .product__description') || "",
    image: document.querySelector('.product__media img, [class*="product-image"] img, .product-single__photo img, .product-featured-media img')?.src || "",
    rating: "",
    reviewCount: "",
    availability: document.querySelector('[class*="sold-out"], .product-form__sold-out')
      ? "Out of Stock" : "In Stock",
    brand: getText('[class*="vendor"], .product-single__vendor, .product__vendor') || "",
    sku: getText('[class*="sku"] [class*="value"], .product-single__sku') || ""
  };
}

function scrapeWooCommerce() {
  return {
    name: getText(".product_title, h1.entry-title") || "",
    price: getText(".woocommerce-Price-amount, .price ins .amount, .price .amount, p.price") || "",
    currency: getText(".woocommerce-Price-currencySymbol") || "",
    description: getText(".woocommerce-product-details__short-description, .product-short-description") || "",
    image: document.querySelector(".woocommerce-product-gallery__image img, .wp-post-image")?.src || "",
    rating: getText(".star-rating")?.match(/[\d.]+/)?.[0] || "",
    reviewCount: getText(".woocommerce-review-link")?.match(/\d+/)?.[0] || "",
    availability: document.querySelector(".out-of-stock") ? "Out of Stock" :
                  document.querySelector(".in-stock") ? "In Stock" : "",
    brand: "",
    sku: getText(".sku, .sku_wrapper .sku") || ""
  };
}

function scrapeGenericProduct() {
  // Broad selector approach - try many common patterns
  const priceSelectors = [
    '[class*="price" i]:not(style):not(script)',
    '[id*="price" i]:not(style):not(script)',
    '[data-price]'
  ];

  // Get the main/prominent price (usually the largest text with currency)
  let price = "";
  for (const sel of priceSelectors) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      const text = el.textContent.trim();
      // Match price patterns like $29.99, €15, £100, ₹500, 29.99 USD
      const priceMatch = text.match(/[\$\€\£\¥\₹][\s]?[\d,]+\.?\d*|[\d,]+\.?\d*\s?(?:USD|EUR|GBP|INR)/);
      if (priceMatch && priceMatch[0].length > 1) {
        price = priceMatch[0].trim();
        break;
      }
    }
    if (price) break;
  }

  // Product name - prefer specific product title selectors, then fall back to h1
  const name = getText(
    '[class*="product-title" i], [class*="product-name" i], [class*="product_title" i], ' +
    '[class*="productTitle" i], [class*="productName" i], ' +
    '[data-testid*="product-title" i], [data-testid*="product-name" i]'
  ) || getText("h1") || document.title.split("|")[0].split("-")[0].trim();

  const description = getText(
    '[class*="product-description" i], [class*="product_description" i], ' +
    '[class*="productDescription" i], [id*="description" i] p, ' +
    '[class*="description" i]:not(meta)'
  )?.substring(0, 500) || "";

  const imageEl = document.querySelector(
    '[class*="product-image" i] img, [class*="product_image" i] img, ' +
    '[class*="productImage" i] img, [class*="gallery" i] img, ' +
    '[data-testid*="product-image" i] img, .product img, main img[src*="product"], ' +
    'img[class*="product" i]'
  );

  return {
    name,
    price,
    currency: "",
    description,
    image: imageEl?.src || "",
    rating: getText('[class*="rating" i] [class*="value" i], [class*="star-rating" i], [aria-label*="rating" i]')?.match(/[\d.]+/)?.[0] || "",
    reviewCount: "",
    availability: getText('[class*="availability" i], [class*="stock" i]') || "",
    brand: getText('[class*="brand" i]:not(script):not(style)') || "",
    sku: ""
  };
}

// --- Helpers ---

function getText(selector) {
  try {
    const el = document.querySelector(selector);
    if (!el) return "";
    const text = el.textContent.trim().replace(/\s+/g, " ");
    return text || "";
  } catch (e) { return ""; }
}

function getMicrodataProp(el, prop) {
  const node = el.querySelector(`[itemprop="${prop}"]`);
  return (node?.textContent || "").trim();
}

function getMicrodataContent(el, prop) {
  const node = el.querySelector(`[itemprop="${prop}"]`);
  return (node?.content || node?.getAttribute("content") || "").trim();
}

function simplifyAvailability(val) {
  if (!val) return "";
  val = String(val);
  if (val.includes("InStock")) return "In Stock";
  if (val.includes("OutOfStock")) return "Out of Stock";
  if (val.includes("PreOrder")) return "Pre-Order";
  if (val.includes("LimitedAvailability")) return "Limited";
  if (val.includes("Discontinued")) return "Discontinued";
  return val.replace("https://schema.org/", "").replace("http://schema.org/", "");
}
