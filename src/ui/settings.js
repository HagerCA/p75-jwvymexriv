// Settings: which bars show, the targets, Drive, and "Start fresh for Day 1".
import { h, fill } from './dom.js';
import { connect, moveToTest, syncNow, renew } from '../drive.js';
import { GOOGLE_CLIENT_ID } from '../config.js';

export function openSettings(app) {
  const s = JSON.parse(JSON.stringify(app.settings));
  const body = h('div');
  const sh = app.sheet(body, { onClose: () => app.refresh() });
  draw();

  async function persist() {
    await app.store.putSettings(s);
    app.settings = JSON.parse(JSON.stringify(s));
  }

  function num(value, onChange, { min = 0, max = 5000, step = 1 } = {}) {
    const el = h('input', { type: 'number', inputMode: 'decimal', min, max, step, value });
    el.addEventListener('change', async () => {
      const v = Number(el.value);
      if (!Number.isFinite(v) || v < min || v > max) { el.value = value; return; }
      onChange(v);
      await persist();
    });
    return el;
  }

  function sw(label, sub, on, flip) {
    return h(`button.toggle${on ? '.on' : ''}`, { 'aria-pressed': String(on), on: { click: async () => { flip(); await persist(); draw(); } } },
      h('div', null, h('h3', null, label), sub ? h('div.small.muted', null, sub) : null), h('span.switch'));
  }

  function draw() {
    const relay = app.relayOn();
    fill(body, 
      h('h2', null, 'Settings'),

      h('div.settings-group', null,
        h('div.section-title', null, 'Protein goal'),
        h('div.grid2', null,
          h('label.field', null, 'From (g)', num(s.proteinBand.min, (v) => { s.proteinBand.min = v; }, { max: 300 })),
          h('label.field', null, 'To (g)', num(s.proteinBand.max, (v) => { s.proteinBand.max = v; }, { max: 300 })),
        ),
      ),

      h('div.settings-group', null,
        h('div.section-title', null, 'Also show'),
        h('div.stack', null,
          sw('Fat', `${s.fat.target} g a day`, s.fat.on, () => { s.fat.on = !s.fat.on; }),
          s.fat.on ? h('label.field', null, 'Fat target (g)', num(s.fat.target, (v) => { s.fat.target = v; }, { max: 300 })) : null,
          sw('Fiber', `${s.fiber.min} to ${s.fiber.max} g a day`, s.fiber.on, () => { s.fiber.on = !s.fiber.on; }),
          s.fiber.on ? h('div.grid2', null,
            h('label.field', null, 'Fiber from (g)', num(s.fiber.min, (v) => { s.fiber.min = v; }, { max: 300 })),
            h('label.field', null, 'Fiber to (g)', num(s.fiber.max, (v) => { s.fiber.max = v; }, { max: 300 })),
          ) : null,
          sw('Calories', `${s.calories.target.toLocaleString('en-US')} a day`, s.calories.on, () => { s.calories.on = !s.calories.on; }),
          s.calories.on ? h('label.field', null, 'Calorie target', num(s.calories.target, (v) => { s.calories.target = v; }, { max: 6000, step: 10 })) : null,
        ),
      ),

      h('div.settings-group', null,
        h('div.section-title', null, 'Google Drive'),
        driveBlock(),
      ),

      h('div.settings-group', null,
        h('div.section-title', null, 'Meal reading'),
        h('p', null, relay ? 'On. Meal photos and typed lines are read by Gemini. Body photos never are.' : 'Not switched on yet. You can still add meals by hand.'),
      ),

      h('div.settings-group', null,
        h('div.section-title', null, 'Start fresh for Day 1'),
        h('p.small.muted', null, 'Moves every meal, workout and check-in logged so far into a Test folder on your Drive, and clears this phone for Day 1. Your settings and your usuals stay.'),
        h('button.btn.ghost', { on: { click: fresh } }, 'Start fresh for Day 1'),
      ),
    );
  }

  function driveBlock() {
    if (!GOOGLE_CLIENT_ID) return h('p.muted', null, 'Drive is not set up yet.');
    if (s.drive.connected && !app.driveWaiting) {
      return h('div.stack', null,
        h('p', null, 'Connected. Everything mirrors to a "75 Petite" folder in your Drive.'),
        h('button.btn.ghost', { on: { click: syncButton } }, 'Back up now'),
      );
    }
    return h('div.stack', null,
      h('p.muted', null, s.drive.connected
        ? 'Drive needs you to sign in again. Everything is safe on this phone until then.'
        : 'Keeps a copy of everything, photos included, in your own Drive. The app can only see the files it makes.'),
      h('button.btn', { on: { click: connectDrive } }, s.drive.connected ? 'Reconnect Drive' : 'Connect Google Drive'),
    );
  }

  async function connectDrive(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    const ok = s.drive.connected ? await renew(GOOGLE_CLIENT_ID) : await connect(GOOGLE_CLIENT_ID);
    if (!ok) {
      btn.disabled = false;
      app.toast("That didn't connect. Try again?");
      return;
    }
    s.drive.connected = true;
    await persist();
    app.driveWaiting = false;
    // The first sync merges Drive's copy in before it writes anything, so a new
    // or wiped phone gets everything back and never overwrites the backup.
    const r = await syncNow(app.store, app.driveApi(), { renew: () => renew(GOOGLE_CLIENT_ID) });
    await app.load();
    Object.assign(s, JSON.parse(JSON.stringify({ ...app.settings, drive: s.drive })));
    draw();
    app.render();
    app.toast(r.waiting || r.error ? 'Connected. The first backup will finish when the signal is steady.' : 'Connected and backed up.');
  }

  async function syncButton(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    const r = await syncNow(app.store, app.driveApi(), { renew: () => renew(GOOGLE_CLIENT_ID) });
    btn.disabled = false;
    if (r.waiting) {
      app.driveWaiting = true;
      draw();
    } else if (r.error) {
      app.toast('No signal right now. It will back up when you are online.');
    } else {
      app.toast(r.uploaded ? 'Backed up.' : 'Already backed up.');
    }
  }

  async function fresh() {
    if (GOOGLE_CLIENT_ID && (!s.drive.connected || app.driveWaiting)) {
      app.toast('Connect Drive first, so the practice data can move to your Drive.');
      return;
    }
    const msg = GOOGLE_CLIENT_ID
      ? 'Move everything logged so far to the Test folder and start clean for Day 1? Your settings and usuals stay.'
      : 'Drive is not set up, so the practice data will be cleared, not moved. Start clean for Day 1? Your settings and usuals stay.';
    if (!confirm(msg)) return;
    try {
      await moveToTest(app.store, app.driveApi());
    } catch {
      app.toast("Couldn't reach Drive. Nothing was moved; try again with signal.");
      return;
    }
    for (const id of [...app.photoUrls.keys()]) app.forgetPhotoUrl(id);
    sh.close();
    await app.refresh();
    app.toast('Clean slate. Day 1 starts Monday.');
  }
}
