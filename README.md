# Trip Calculator

A small, minimal web app for tracking a group trip's money: how much was collected from each member, what has been spent, and what is left.

- **Dashboard:** Total Collected, Total Expenses and Remaining Balance at the top, with a thin bar showing how much has been spent.
- **Members:** add, edit and remove members and the amount each has contributed.
- **Expenses:** add, edit and remove expenses, newest first.
- **Categories:** every expense has a category and a payer (the trip fund or a member). Add, rename and delete your own categories under **Manage**.
- **Spending chart:** a doughnut chart of spending by category with amounts and percentages. Tap a category to see its expenses.
- **View Details:** the full breakdown, with expense history and category filters, member contributions and spending, each member's fair share and balance, and a **Settle up** list of who pays whom.
- **Undo:** removing a member or expense shows an Undo option for a few seconds.
- **Saved in the browser:** by default data is stored in `localStorage` on the device. There is no server and nothing is uploaded.
- **Optional live sync:** with Firebase set up, everyone with the link sees the trip update live, and only you (signed in with Google) can edit.
- **Responsive:** side-by-side lists on desktop, a Members / Expenses switch on mobile. Follows the system light or dark setting.

## Run it

Open `index.html` in a browser. No build step or dependencies.

## Publish on GitHub Pages

1. Push these files to the repository root.
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.

Files: `index.html`, `styles.css`, `app.js`, `firebase-config.js`, `database.rules.json`.

## Live sync with Firebase (optional)

Without this, every visitor gets their own private trip in their own browser. With it, the trip is stored in Firebase: anyone with the link can view it live, and only you can change it.

1. **Create a project.** Go to [console.firebase.google.com](https://console.firebase.google.com), add a project (Google Analytics not needed).
2. **Add a database.** Build → **Realtime Database** → Create database. Pick a location (e.g. Singapore, `asia-southeast1`) and start in **locked mode**.
3. **Turn on Google sign-in.** Build → **Authentication** → Get started → Sign-in method → **Google** → Enable → Save.
4. **Allow your site.** Authentication → Settings → **Authorized domains** → Add domain → `fabooluxinterior.github.io`.
5. **Get the config.** Project settings (gear icon) → Your apps → **Web** (`</>`) → register an app (no Hosting needed). Copy the values from the `firebaseConfig` it shows.
6. **Fill in `firebase-config.js`.** Replace `null` with the config, using the example in that file. Make sure `databaseURL` is included — copy it from the top of the Realtime Database page if it is missing.
7. **Find your user ID.** Push the change, open the GitHub Pages site and tap **Sign in to edit** with your Google account. Then in Firebase, Authentication → **Users**, copy the **User UID** of your account.
8. **Lock it to you.**
   - Put the UID in `firebase-config.js` as `ownerUid`.
   - In Firebase, Realtime Database → **Rules**, paste the contents of `database.rules.json` with `PASTE_YOUR_UID_HERE` replaced by your UID, then **Publish**.

The first time you sign in on a device that already has local trip data and the database is empty, that data is uploaded automatically.

**Rules matter.** The `firebase-config.js` values are public and that is fine; the database rules are what stop other people from editing. Never use rules that allow `.write: true` or `auth != null` alone — any Google account could then change or erase the trip.
