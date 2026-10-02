# HCI Photo Report

A simple web app for Project Managers. Search a JobTread job, pull its photos, pick them like slides, make a PDF, email it, and save it back to the job.

**How it fits together**

| Part | Where | Holds secrets? |
|---|---|---|
| Web app (this folder) | GitHub Pages, later `photos.hcisf.com` | No |
| Backend (`apps-script/Code.gs`) | Google Apps Script, owned by your Google Workspace account | Yes: the JobTread key |

Only people with the JobTread role **Admin** or **Project Manager** can sign in. They get a 6-digit code by email. Customer and vendor logins are refused.

## 1. Backend (about 10 minutes, one time)

Do this while signed in to the Google account that can send mail as **info@hcisf.com**.

1. Go to script.google.com, click **New project**, name it `HCI Photo Report`.
2. Delete the sample code. Paste all of `Code.gs` (it is kept out of this public repo; get it from the zip file or the JT project doc). Save.
3. **Project Settings (gear) > Script properties > Add**:
   - `JT_KEY` = your JobTread grant key. **Only you paste this.** Never email it or put it in GitHub.
   - `SENDER_EMAIL` = `info@hcisf.com`
4. Pick `checkAllowList` in the function list, click **Run**, approve the permissions. The log should list your Admins and PMs (8 people today).
5. Pick `checkSendCode`, click **Run**. You should receive a test email from info@hcisf.com. If it comes from your own address instead, add info@ under Gmail > Settings > Accounts > "Send mail as".
6. **Deploy > New deployment > Web app**. Execute as: **Me**. Who has access: **Anyone**. Click Deploy and copy the **Web app URL**.
   - "Anyone" only means the URL opens. Every data call needs a sign-in token.
   - If "Anyone" is missing, a Workspace admin must allow it (Admin console > Apps > Google Workspace > Drive and Docs > Sharing).
7. Whenever `Code.gs` changes: **Deploy > Manage deployments > Edit > New version**. The URL stays the same.

## 2. Web app

1. Open `js/config.js` and replace `PASTE_APPS_SCRIPT_WEB_APP_URL_HERE` with the Web app URL.
2. Create the repo `photo-report` in the GitHub organization Hon-s-Construction-Inc. Upload the front-end files only. Do not upload `Code.gs` or `test/`.
3. **Settings > Pages > Deploy from a branch > main / (root)**. The site appears at `https://hon-s-construction-inc.github.io/photo-report/`.
4. The repo is public. That is fine: it holds no keys. Do not add any.

## 3. Move to photos.hcisf.com later

1. In the DNS for hcisf.com add one record: `CNAME` host `photos` pointing to `hon-s-construction-inc.github.io`.
2. In the repo, **Settings > Pages > Custom domain** = `photos.hcisf.com`. Tick **Enforce HTTPS** when it becomes available.
3. No payment is needed. The subdomain and the HTTPS certificate are free.
4. **Tell the Webflow developer:**
   - Add records one by one in the existing DNS. Do not change nameservers and do not use Quick Connect.
   - Leave the MX records alone, or hcisf.com email stops working.
   - Leave the `photos` CNAME in place.

## 4. iPad home-screen icon

Open the site in **Safari > Share > Add to Home Screen**. It opens full screen like the JobTread app.

## 5. Who can sign in

Whoever has the JobTread role Admin or Project Manager, matched by their JobTread email. New PM: set the role in JobTread. Access appears within 5 minutes. Removing the role removes access, even for someone already signed in.

To change the rule, edit `ALLOWED_ROLES` in `Code.gs`.

## 6. First-run checklist

- [ ] Sign in with a PM email, then with a non-PM email (no code arrives).
- [ ] Search a job with photos, for example by house number. Pull photos.
- [ ] Pick a Before and an After, then **Generate PDF**. Compare with a CompanyCam report.
- [ ] **Save to JobTread**. Confirm the PDF is in the job under Files > Reports.
- [ ] On the iPad: Email / Share opens the share sheet, then Mail.

## Settings you can change

- `js/config.js`: company name, time zone, PDF photo size and quality.
- `Code.gs` (`CFG`): allowed roles, session length (12 h), saved-report folder name (`Reports`), page size.

## Known limits

- Only photos stored in JobTread appear. Old CompanyCam photos are not in JobTread.
- Photos are shrunk to 1000 px for the PDF to keep emails small.
- Reports are not saved as drafts in JobTread. A browser draft is kept on the same device per job.
- Tests and `Code.gs` are not in the public repo.
