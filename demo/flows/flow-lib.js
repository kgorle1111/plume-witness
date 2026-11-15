// Holds stay under 3 s: craftlint warns on a static hold longer than that (STATIC-HOLD).
// Shared steps for the Plume Witness replay takes. Each beat file drives one fresh page load from capture.sh.
// Only clicks, hovers and scrolls: nothing here rewrites the page, so the take shows the app as built.
const hold = (page, ms) => page.waitForTimeout(ms);

// Wide screens (capture.sh records at 1280x720) open with a globe intro. The b1-b4 takes start on the flat
// replay, so they need `?intro=0`; pass it in capture.sh --url to avoid the reload below showing in the take.
async function openFlat(page) {
  const url = new URL(page.url());
  if (!/^https?:$/.test(url.protocol) || url.searchParams.get('intro') === '0') return;
  url.searchParams.set('intro', '0');
  await page.goto(url.toString(), { timeout: 30000 });
}

// Waits for the flat replay: data-phase is "globe" or "flying" during the intro and "flat" after it.
async function waitForFlat(page, timeout = 15000) {
  await page.locator('.map-canvas[data-phase="flat"]').waitFor({ timeout });
}

async function ready(page) {
  await openFlat(page);
  await page.locator('h1.event-title').waitFor({ timeout: 15000 });
  // The map is lazy-loaded and its tiles come from tiles.openfreemap.org; give it time to paint before the hold.
  await page.locator('.map-wrap canvas').first().waitFor({ timeout: 15000 }).catch(() => {});
  await waitForFlat(page);
  await hold(page, 3000);
}

async function tab(page, name) {
  await page.getByRole('tab', { name, exact: true }).click();
  await hold(page, 800);
}

// Scrolls only the panel that holds the element: scrollIntoView also scrolls the window once the panel hits its end,
// which pushes the header off screen and leaves white space under the map.
async function glide(locator, page, ms = 1400) {
  await locator.evaluate((el) => {
    let box = el.parentElement;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    if (!box) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 12;
    box.scrollTo({ top, behavior: 'smooth' });
  });
  await hold(page, ms);
}

// A real wheel zoom on the map, so a shot opens on motion (craftlint OPENING-STATIC) instead of a still page.
async function zoomMap(page, x, y, ticks, dy = -120) {
  await page.mouse.move(x, y);
  for (let i = 0; i < ticks; i++) {
    await page.mouse.wheel(0, dy);
    await hold(page, 220);
  }
  await hold(page, 900);
}

module.exports = { hold, ready, tab, glide, zoomMap, waitForFlat };
