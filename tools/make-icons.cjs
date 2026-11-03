// Renders web/icons/icon.svg to the PNG sizes iOS and the manifest need. Run: node tools/make-icons.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, "../web/icons/icon.svg"), "utf8");
  const browser = await chromium.launch();
  for (const size of [180, 192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0;background:#8fd8f5}svg{width:${size}px;height:${size}px;display:block}</style>${svg.replace('rx="96"', 'rx="0"')}`);
    await page.screenshot({ path: path.join(__dirname, `../web/icons/icon-${size}.png`) });
    await page.close();
  }
  await browser.close();
})();
