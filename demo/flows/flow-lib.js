// Holds stay under 3 s: craftlint warns on a static hold longer than that (STATIC-HOLD).
// Shared steps for the Plume Witness replay takes. Each beat file drives one fresh page load from capture.sh.
// Only clicks, hovers and scrolls: nothing here rewrites the page, so the take shows the app as built.
const hold = (page, ms) => page.waitForTimeout(ms);

async function ready(page) {
  await page.locator('h1.event-title').waitFor({ timeout: 15000 });
  // The map is lazy-loaded and its tiles come from tiles.openfreemap.org; give it time to paint before the hold.
  await page.locator('.map-wrap canvas').first().waitFor({ timeout: 15000 }).catch(() => {});
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

module.exports = { hold, ready, tab, glide, zoomMap };
