const { hold, ready, glide, glideWindow, waitForFlat } = require('./flow-lib.js');

// Shot 5 (1:05-1:22): the header link "Past spikes", the calendar, the table filtered to "No matching report",
// one row's "Replay this night", then on that night's Trace step the "Manchester" shortcut (violet pin + readout).
module.exports = async (page) => {
  await ready(page);
  // The header's link: since the site footer (PR #50) there is a second "Past spikes" link at the bottom.
  await page.getByRole('banner').getByRole('link', { name: 'Past spikes', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: /^Past spikes/ }).waitFor({ timeout: 15000 });
  await hold(page, 2200); // 415 spikes, 8 monitors
  await glideWindow(page.locator('figure.sl-cal'), page, 1200);
  await hold(page, 2200); // the calendar heatmap
  await page.locator('#sl-status').selectOption('no_report_after_deadline');
  await hold(page, 2200); // calendar and count follow the filter
  await glideWindow(page.locator('.sl-table-wrap'), page, 1200);
  await hold(page, 1800);
  // The row's own "Replay this night" link, opened with `intro=0` added (the same as tapping it, then "Skip intro"),
  // so the replayed night starts flat and the cut needs no globe intro trimmed out. The href is read, never changed.
  const replay = page.getByRole('link', { name: /^Replay / }).first();
  const target = new URL(await replay.getAttribute('href'), page.url());
  target.searchParams.set('intro', '0');
  await replay.hover();
  await page.goto(target.toString(), { timeout: 30000 });
  await page.locator('h1.event-title').waitFor({ timeout: 15000 });
  await waitForFlat(page, 15000);
  await hold(page, 2000);
  await page.getByRole('tab', { name: 'Trace', exact: true }).click();
  await hold(page, 1800);
  const chip = page.getByRole('button', { name: 'Manchester', exact: true });
  await chip.scrollIntoViewIfNeeded();
  await hold(page, 600);
  await chip.click();
  await page.locator('.ps-readout').waitFor({ timeout: 5000 });
  await hold(page, 1200); // the violet pin on the map
  await glide(page.locator('.ps-readout'), page, 1200);
  await hold(page, 2600); // the readout: nearest monitor, inside or outside the corridor
};
