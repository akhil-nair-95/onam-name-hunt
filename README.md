# ഓണം നെയിം ഹണ്ട് — Name Hunt contest app

A tiny, free, no-server contest app:
- Anyone can suggest a name and upvote others'.
- One vote per name per device (no login needed for visitors).
- You (the admin) can close voting and declare a winner — either the
  highest-voted name, or a true random pick among all submissions.
- Runs entirely on **GitHub Pages** (free static hosting) + **Firebase**
  (free tier, no credit card required). No servers to maintain, no cost.

Everything updates live — when someone submits or votes, everyone else's
page updates within a second or two, no refresh needed.

---

## 1. Create a Firebase project (5 min, free)

1. Go to <https://console.firebase.google.com/> and sign in with any Google account.
2. **Add project** → give it a name (e.g. `onam-name-hunt`) → you can
   disable Google Analytics (not needed) → **Create project**.
3. In the left sidebar: **Build → Firestore Database → Create database**.
   - Choose any nearby region.
   - Start in **production mode** (we'll paste our own rules in step 4).
4. In the left sidebar: **Build → Authentication → Get started**.
   - Under **Sign-in method**, enable **Anonymous**.
   - Also enable **Email/Password** (this is how *you* log into the admin page).

## 2. Create your admin account

1. Still in **Authentication → Users** tab → **Add user**.
2. Enter an email and password you'll remember — this is your admin login
   for `admin.html`. (It doesn't need to be a real inbox; nothing gets
   emailed to it.)
3. After it's created, **click on that user row** and copy their **User
   UID** (a long string like `aB3xY...`). You'll need it in step 4.

## 3. Register a web app & get your config

1. In **Project settings** (gear icon, top left) → scroll to **Your apps**
   → click the **</>** (web) icon → give it any nickname → **Register app**.
   You do *not* need Firebase Hosting — skip that checkbox.
2. You'll see a `firebaseConfig` object like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "onam-name-hunt.firebaseapp.com",
     projectId: "onam-name-hunt",
     storageBucket: "onam-name-hunt.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abc123"
   };
   ```
3. Open **`firebase-config.js`** in this project and replace the
   placeholder values with your real ones.

   > This file is public by design — every visitor's browser downloads it.
   > That's normal and safe for Firebase web apps. The actual security is
   > enforced by `firestore.rules` (next step), not by hiding this file.

## 4. Lock down access with security rules

1. In Firebase Console: **Build → Firestore Database → Rules** tab.
2. Open **`firestore.rules`** in this project, and find this line:
   ```
   return request.auth != null && request.auth.uid == "REPLACE_WITH_ADMIN_UID";
   ```
3. Replace `REPLACE_WITH_ADMIN_UID` with the User UID you copied in step 2.
4. Paste the **entire contents** of `firestore.rules` into the Firebase
   Console rules editor, replacing what's there, then click **Publish**.

Without this step, anyone could declare themselves the winner — don't skip it.

## 5. Test it locally (optional but recommended)

You can't just double-click `index.html` — browsers block ES module
imports from `file://` URLs. Run a tiny local server instead, from inside
this folder:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser. Try submitting a name,
then open <http://localhost:8000/admin.html> in another tab and log in
with your admin email/password.

## 6. Deploy to GitHub Pages (free)

1. Push this folder to a new GitHub repository:
   ```bash
   git add -A
   git commit -m "Onam Name Hunt contest app"
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
2. On GitHub: repo → **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch**, branch `main`,
   folder `/ (root)` → **Save**.
4. After a minute, your site is live at
   `https://<your-username>.github.io/<repo-name>/`.
5. Share that link with everyone. Share
   `https://<your-username>.github.io/<repo-name>/admin.html` with no one
   but yourself.

---

## How it works, briefly

- **Visitors** are signed into Firebase *anonymously* the moment they load
  the page — invisible, no login screen. This gives each device a stable
  ID used only to stop double-voting.
- **Submitting a name that already exists** doesn't create a duplicate —
  it just casts your vote for the existing one instead, and tells you so.
- **You (admin)** log in with a real email/password on `admin.html`. Only
  your specific account (matched by UID in `firestore.rules`) is allowed
  to close voting or declare a winner — enforced by Firestore itself, not
  just by hiding the page.
- **Random pick** gives every submitted name an equal chance, regardless
  of votes. **Highest votes** picks the current leader (ties broken
  randomly). Either one immediately closes voting and shows the winner
  on the public page for everyone.

## Costs

Firebase's free "Spark" plan covers this comfortably — it's built for
exactly this scale (a few hundred people, a few thousand reads/writes).
GitHub Pages is free for public repos. Total cost: **$0**.

## Customizing

- Colors/fonts: `style.css` (same palette as the event poster).
- Malayalam text: search for it directly in `index.html` / `admin.html`.
- Deadline shown on the banner: edit the text in `index.html` — it's
  just a label, actual cutoff is whenever you click "Close submissions"
  in the admin page.
