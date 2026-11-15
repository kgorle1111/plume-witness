const { hold, ready, zoomMap } = require('./flow-lib.js');

// Shot 1 (0:00-0:12): the header, the reading and the Milby Park sparkline with its 9:00 bar, all in the first view.
// The panel holds still; the motion is real map zooms on the monitor, so the shot does not open on a still page.
module.exports = async (page) => {
  await ready(page);
  await zoomMap(page, 250, 440, 3, -140); // close in on the Milby Park monitor
  await hold(page, 2000);
  await zoomMap(page, 250, 440, 2, -100);
  await hold(page, 2200);
  await zoomMap(page, 250, 440, 3, 140);
  await hold(page, 2200);
  await zoomMap(page, 250, 440, 2, 100);
  await hold(page, 2000);
};
