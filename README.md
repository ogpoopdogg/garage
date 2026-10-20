# E&C Garage

| Page | URL | Who |
| --- | --- | --- |
| Garage | `https://app.eandccourier.ca/garage/` (opens `garage.html`) | The time clock admins: `justin@ec.com`, `desirae@ec.com`, `celeste@ec.com` |

One page for everything we know about each vehicle:

- **Info and parts:** headlight and other bulb types, fluids, tire sizes, filters, wipers,
  battery, plate and VIN, notes. Each entry has a name, a type or size, and optionally a part
  number, a *where to buy* link and a note. Each one shows who added it and who last changed it.
- **Categories:** the sections every vehicle has. The page starts with Lights, Fluids, Tires,
  Filters, Wipers, Battery, Plate / VIN and Notes; on **Categories** you can rename, reorder,
  delete or add your own. Deleting one moves its entries to *Other* on each vehicle; nothing
  is deleted with it.
- **Fields:** each category picks the fields its entries have (**Fields** on its row, or when you
  add one). Check the ones it uses, name each one (for example only a *Model number*), put them
  in order, and add fields of its own. Categories from before this have all five built-in fields
  (What, Type or size, Part number, Where to buy, Note). Unchecking a field hides it on new
  entries; an entry that already has something in it still shows it, and a field of its own
  can only be removed once no entry uses it.
- **Vehicle problems:** the reports drivers send from **Vehicle Check** on the time clock, plus
  any an admin adds with **+ Add problem**. **Mark fixed** saves a note, who fixed it and when;
  fixed problems stay on the vehicle and on the **Vehicle checks** tab, and **Reopen** opens one again.
- **Oil checks:** each vehicle's last check and its checks from the last 60 days (**Show older**
  goes back 90 days more each time). The **Vehicle checks** tab lists the last two weeks across
  all vehicles; a missed one waits for **Got it**. Drivers on the clock who haven't checked yet show too.
- **Oil check schedule:** how often drivers are asked to check each vehicle's oil (moved here
  from the time clock admin panel), on the **Oil schedule** tab or on each vehicle.
- **Service log:** oil changes, brakes, tires and other work, with the date, km and cost.
- **Service due:** reminders such as "oil change at 190,000 km or in 6 months", with a *Due soon*
  tag 1,000 km or 14 days ahead and *Overdue* after. **Done** logs the service and moves a
  repeating reminder to the next time. The vehicle's km is the higher of **Update km** and the
  service log.
- **Changes:** each vehicle lists who changed what in Garage. Changes to the categories and to the
  schedule for all vehicles show on the Oil schedule and Categories tabs.
- **Trash:** deleted entries, service, reminders and removed vehicles stay in **Trash** for 30
  days, where **Put back** restores them.
- **Search and filters:** search finds an entry on every vehicle, for example `H11` or `wiper`;
  the filters show only vehicles with open problems, oil due or service due.
- **Export spreadsheet:** one CSV file with every vehicle's info, service, reminders and problems.
- **Install as an app** and **no signal:** Garage installs like the admin panel (the *Install app*
  button, or *Add to Home Screen* on an iPhone) and opens with no signal, showing the copy it saved
  on that device last time. Nothing can be saved until the signal is back. Signing out deletes the copy.

The vehicles are matched **by name only**, never by GPS unit: the GPS units move from vehicle to
vehicle. Garage lists the vehicles in RouteWatcher (GPS) and the vans in the time clock's
**Admin → Vehicles → Vehicles without GPS** (one vehicle when both have the same name), plus
any added here with **+ Add vehicle** (for one drivers don't pick), plus any that still have
entries after leaving that list (under *No longer in the van list*). "Van 12", "12" and
"Vehicle 12" are one vehicle. **Remove vehicle** hides one in Garage and puts its entries in
the Trash; it stays on the time clock. A problem or oil check a driver saves under a GPS
unit's own name (not a vehicle's) shows on the Vehicle checks tab but on no vehicle page.
To leave the RouteWatcher vehicles out, set `GPS_UNITS_ARE_VEHICLES` in `garage.html` to `false`.
Works on phones and computers.

## How it fits with the time clock

Garage is served by GitHub Pages next to the time clock (`app.eandccourier.ca/timeclock/`)
and loads the time clock's own code from there (`../timeclock/tc-core.js`): the Firebase
project and sign-in, the admin list, the vehicle list and the oil check rules. So both always
agree, and an admin signed in to the admin panel is already signed in here. The rest of
Firebase is loaded in the version `tc-core.js` names (`FIREBASE_SDK`; 12.19.0 if it doesn't).
Because a change in the timeclock repo can break Garage, a GitHub check here downloads the
current `tc-core.js` every day and fails if anything Garage uses is gone (`tests/timeclock.test.mjs`).

It uses the same Firebase Realtime Database (`eandccourier-36fcc`):

| Path | What | Written by |
| --- | --- | --- |
| `garage/categories/{id}` | `{ name, order, fields }`; `fields/{key}`: `{ name, order, off }`, key `label`, `value`, `part`, `link`, `note` or `x…` (its own); no `fields`: all five built-in ones | Garage |
| `garage/vehicles/{key}` | `{ name, listed, removed }`: `listed` added in Garage, `removed` removed in Garage | Garage |
| `garage/vehicles/{key}/items/{id}` | `{ cat, label, value, part, link, note, extra, added, addedBy, at, by }`; `extra/{key}`: the category's own fields; at least one field filled in | Garage |
| `garage/vehicles/{key}/service/{id}` | `{ day, what, km, cost, note, added, addedBy, at, by }` | Garage |
| `garage/vehicles/{key}/reminders/{id}` | `{ what, dueKm, dueDay, everyKm, everyMonths, note, added, addedBy, at, by }` | Garage |
| `garage/vehicles/{key}/odo` | `{ km, day, at, by }`: the last km entered | Garage |
| `garage/trash/{id}` | `{ at, by, kind, vkey, vname, id, data }`, deleted after 30 days | Garage |
| `garage/history/{key}/{id}` | `{ at, by, text }` (`_all`: changes for every vehicle) | Garage |
| `timeclock/vans` | The time clock's vans without GPS (Garage's vehicle list) | Admin panel |
| `developer/dispatch_dashboard/drivers` | The RouteWatcher vehicles (GPS), read only (Garage's vehicle list) | RouteWatcher |
| `timeclock/van_reports` | Vehicle Check reports | Drivers and Garage; Garage marks them fixed or reopens them |
| `timeclock/shifts/{ek}/{id}/oil` | The oil check on each shift | Drivers; Garage marks a missed one as seen |
| `timeclock/oil_plan`, `timeclock/oil_last` | The oil check schedule and each vehicle's last check | Garage (schedule), drivers (last check) |

`{key}` is the vehicle's name in lower case with only letters and digits, and "van" or
"vehicle" left out (`vanKey` in `tc-core.js`), the same key the oil check uses.

`added`/`addedBy` are who first saved something and when; `at`/`by` are the last change.

## Set up before first use

1. **Turn on GitHub Pages** for this repository: Settings → Pages → *Deploy from a branch*,
   `main`, `/ (root)`. The `ogpoopdogg.github.io` site's custom domain then serves it at
   `app.eandccourier.ca/garage/`.
2. **Add the database rules.** Firebase console → **Realtime Database** → **Rules**: add the
   `garage` block from `database.rules.json` next to the `timeclock` block. Don't replace
   the whole file, or you'll remove the rules the time clock and your other apps rely on.
   Only the three admins can read or change `garage/`. The time clock's rules already let
   the admins mark problems fixed, mark oil checks seen and change the schedule.
3. To add or remove an admin, change the email in `ADMIN_EMAILS` in the time clock's
   `tc-core.js` (lets them in) and in **both** `database.rules.json` files (lets them read
   and change the data), then publish the rules.

Until the rules are published, the page says it couldn't load (permission denied), with a
*Try again* button.

## Tests

- `node --test tests/garage.test.mjs`: the helpers in `garage-core.js` (vehicle list,
  problems, oil checks, reminders, trash, search, export, entries and service checks).
- `node --test tests/timeclock.test.mjs`: the time clock's current `tc-core.js` still has every
  name `garage.html` uses (`TC_CORE=path/to/tc-core.js` checks a local copy).
- `tests/rules/`: checks `database.rules.json` against the Firebase emulator
  (`npm ci && npm test` in that folder; needs Java 11 or later).

GitHub runs them on every push, and every day.
