# Trip Calculator

A small, minimal web app for tracking a group trip's money: how much was collected from each member, what has been spent, and what is left.

- **Dashboard:** Total Collected, Total Expenses and Remaining Balance at the top, with a thin bar showing how much has been spent.
- **Members:** add, edit and remove members and the amount each has contributed.
- **Expenses:** add, edit and remove expenses, newest first.
- **Undo:** removing a member or expense shows an Undo option for a few seconds.
- **Saved in the browser:** data is stored in `localStorage` on the device. There is no server and nothing is uploaded.
- **Responsive:** side-by-side lists on desktop, a Members / Expenses switch on mobile. Follows the system light or dark setting.

## Run it

Open `index.html` in a browser. No build step or dependencies.

## Publish on GitHub Pages

1. Push these files to the repository root.
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.

Files: `index.html`, `styles.css`, `app.js`.
