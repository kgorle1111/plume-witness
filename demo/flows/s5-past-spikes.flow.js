const { hold, ready, glide, glideWindow, waitForFlat } = require('./flow-lib.js');

// Shot 5 (1:05-1:22): the header link "Past spikes", the calendar, the table filtered to "No matching report",
// one row's "Replay this night", then on that night's Trace step the "Manchester" shortcut (violet pin + readout).
module.exports = async (page) => {
  await ready(page);
  await page.getByRole('link', { name: 'Past spikes', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: /^Past spikes/ }).waitFor({ timeout: 15000 });
  await hold(page, 2200); // 415 spikes, 8 monitors
  await glideWindow(page.locator('figure.sl-cal'), page, 1200);
  await hold(page, 2200); // the calendar heatmap
  await page.locator('#sl-status').selectOption('no_report_after_deadline');
  await hold(page, 2200); // calendar and count follow the filter
  await glideWindow(page.locator('.sl-table-wrap'), page, 1200);
  await hold(page, 1800);
  await page.getByRole('link', { name: /^Replay / }).first().click();
  await page.locator('h1.event-title').waitFor({ timeout: 15000 });
  // A replayed night opens with the globe intro on wide screens; the app's own "Skip intro" button ends it.
  const skip = page.getByRole('button', { name: 'Skip intro' });
  const intro = await skip.waitFor({ timeout: 8000 }).then(() => true, () => false);
  if (intro) {
    await hold(page, 1200);
    await skip.click();
  }
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
