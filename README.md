# E&C Garage

| Page | URL | Who |
| --- | --- | --- |
| Garage | `https://app.eandccourier.ca/garage/` (opens `garage.html`) | The time clock admins: `justin@ec.com`, `desirae@ec.com`, `celeste@ec.com` |

One page for everything we know about each vehicle:

- **Info and parts:** headlight and other bulb types, fluids, tire sizes, filters, wipers,
  battery, plate and VIN, notes. Each entry has a name, a type or size, and optionally a part
  number, a *where to buy* link and a note.
- **Categories:** the sections every vehicle has. The page starts with Lights, Fluids, Tires,
  Filters, Wipers, Battery, Plate / VIN and Notes; on **Categories** you can rename, reorder,
  delete or add your own. Deleting one moves its entries to *Other* on each vehicle; nothing
  is deleted with it.
- **Vehicle problems:** the reports drivers send from **Vehicle Check** on the time clock.
  **Mark fixed** saves a note, who fixed it and when. Fixed problems stay on the vehicle and
  on the **Vehicle checks** tab, under the open ones.
- **Oil checks:** each vehicle's last check and its checks from the last 60 days. The
  **Vehicle checks** tab lists the last two weeks across all vehicles; a missed one waits for
  **Got it**. Drivers on the clock who haven't checked yet show too.
- **Oil check schedule:** how often drivers are asked to check each vehicle's oil (moved here
  from the time clock admin panel), on the **Oil schedule** tab or on each vehicle.
- **Service log:** oil changes, brakes, tires and other work, with the date, km and cost.
- **Search:** finds an entry on every vehicle, for example `H11` or `wiper`.

The vehicles are the same list drivers pick from on the time clock: RouteWatcher's GPS units
and **Admin → Vehicles → Vehicles without GPS**. "Van 12", "12" and "Vehicle 12" are one
vehicle. A vehicle that leaves that list but has entries here stays, under *No longer in the
van list*. Works on phones and computers.

## How it fits with the time clock

Garage is served by GitHub Pages next to the time clock (`app.eandccourier.ca/timeclock/`)
and loads the time clock's own code from there (`../timeclock/tc-core.js`): the Firebase
project and sign-in, the admin list, the vehicle list and the oil check rules. So both always
agree, and an admin signed in to the admin panel is already signed in here.

It uses the same Firebase Realtime Database (`eandccourier-36fcc`):

| Path | What | Written by |
| --- | --- | --- |
| `garage/categories/{id}` | `{ name, order }` | Garage |
| `garage/vehicles/{key}/items/{id}` | `{ cat, label, value, part, link, note, at, by }` | Garage |
| `garage/vehicles/{key}/service/{id}` | `{ day, what, km, cost, note, at, by }` | Garage |
| `timeclock/van_reports` | Vehicle Check reports | Drivers; Garage marks them fixed |
| `timeclock/shifts/{ek}/{id}/oil` | The oil check on each shift | Drivers; Garage marks a missed one as seen |
| `timeclock/oil_plan`, `timeclock/oil_last` | The oil check schedule and each vehicle's last check | Garage (schedule), drivers (last check) |

`{key}` is the vehicle's name in lower case with only letters and digits, and "van" or
"vehicle" left out (`vanKey` in `tc-core.js`), the same key the oil check uses.

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

Until the rules are published, the page opens but saving an entry or a category shows
*permission denied*.

## Tests

- `node --test tests/garage.test.mjs`: the helpers in `garage-core.js` (vehicle list,
  problems, oil checks, search, entries and service checks).
- `tests/rules/`: checks `database.rules.json` against the Firebase emulator
  (`npm ci && npm test` in that folder; needs Java 11 or later).

GitHub runs both on every push.
