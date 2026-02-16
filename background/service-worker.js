chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("Smart Web Scraper installed successfully.");
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "DOWNLOAD_FILE") {
    chrome.downloads.download({
      url: message.url,
      filename: message.filename,
      saveAs: true
    }, (downloadId) => {
      sendResponse({ success: true, downloadId });
    });
    return true;
  }
});
