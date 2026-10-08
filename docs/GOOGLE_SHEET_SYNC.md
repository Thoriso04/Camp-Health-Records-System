# Google Form → CHRS registration sync

Parents register a child on a **Google Form**. The answers land in a **Google Sheet**. On the Windows laptop, someone presses **Sync now** and the new children appear in CHRS, with no CSV exporting or uploading.

```
Parent ──► Google Form ──► Google Sheet ──(Sync now, needs internet)──► CHRS local database
                                                                          │
                                         everything else in CHRS ◄────────┘  works fully offline
```

Sync is the **only** feature that uses the internet, and only while the button is being pressed. If the laptop is offline, the sync fails with a clear message and nothing in CHRS changes.

---

## 1. Build the Google Form (once)

**Quickest way: let the script build it.** `docs/google-form/create-registration-form.gs` creates the Form *and* its response Sheet with every title, type and "required" setting below, the Foundation's consent / media-release / indemnity wording, phone-number validation, and plain-text formatting on the phone columns. Steps are in the comment at the top of the file (about 2 minutes). Edit the `CONFIG` block (camp name, dates, venue, deadline) first. If you use the script, skip to the "Not captured" notes below, then go to §3.

**Or build it by hand** from the paper *Registration* and *Medical* pages. **Use these exact question titles**: CHRS finds columns by title, so order doesn't matter and extra questions are harmless (they're just reported as "not imported").

Put long legal wording (the consent paragraph, the indemnity text) in the question's **description**, not its title.

| Question title | Form type | Required |
|---|---|---|
| Child's name | Short answer | ✔ |
| Surname | Short answer | ✔ |
| Date of birth | **Date** | ✔ |
| Sex | Multiple choice or short answer | |
| T-shirt size | Short answer / dropdown | |
| Address | Paragraph | |
| Cell number | Short answer | |
| Language spoken | Short answer | |
| Parent/Primary Caregiver name and surname | Short answer | ✔ |
| Parent/Primary Caregiver cell number | Short answer | ✔ |
| Emergency contact name | Short answer | ✔ |
| Emergency contact cell number | Short answer | ✔ |
| Emergency contact relationship to child | Short answer | |
| Diagnosis | Short answer | ✔ |
| Clinic/Hospital file number | Short answer | |
| Clinic/Hospital/Doctor contact details | Paragraph | |
| Allergies | Paragraph (separate with commas or new lines; write "None" if none) | ✔ |
| Current medication | Paragraph (**one medication per line**) | |
| Medication handed in | Multiple choice: Yes / No | |
| Viral load > 1000 copies/ml | Multiple choice: Yes / No | |
| TB history | Checkboxes: Current, Past, Negative, On treatment | |
| Hepatitis B | Multiple choice: Yes / No | |
| Adherence barriers | Paragraph | |
| Dietary requirements | Paragraph | |
| Religion | Short answer | |
| Additional information to disclose | Paragraph | |
| Additional camper information | Paragraph | |
| **Consent to disclosure** | Checkbox, single option, e.g. "I consent" | ✔ **(rows without it are not imported)** |
| Media release | Checkbox, single option | |
| Indemnity agreement | Checkbox, single option, e.g. "I agree to the indemnity" | ✔ (kept in the sheet as the record of agreement; not imported into CHRS) |
| Parent/guardian full name | Short answer | ✔ |
| Camp session date *(optional)* | Date | |

**Date questions:** use the Form's **Date** type for date of birth. It reaches CHRS as an unambiguous date. If it is a text box instead, CHRS accepts `YYYY-MM-DD`, and `DD/MM/YYYY` only when the day is above 12. A date like `03/04/2012` is flagged rather than guessed.

**Phone numbers:** Google Sheets can drop the leading `0` from numbers typed into a Form (`082…` → `82…`). Before the Form goes live, select the phone-number columns in the response sheet, choose **Format → Number → Plain text**, then submit a test response and check the `0` survives. Emergency numbers need to be right.

The script's Form leaves out **Camp session date** (parents shouldn't have to answer it; the dashboard supplies it) and **Race**.

Not captured: **signatures** (Google Forms can't take one. The Form records a ticked indemnity box plus the guardian's typed full name; whether that is legally enough in place of the signed indemnity is a question for the Foundation's lawyer. Until then, keep collecting the signed form. Synced children have no signature on file in CHRS), **race / work phone numbers** from the paper form (CHRS has no fields for them).

### Photo upload question (add by hand)

The Form-building script cannot add a file-upload question (Google's Apps Script has no way to), so add it yourself in the Form editor, **after** running the script:

1. Open the Form → **Add question** → type **File upload**.
2. Title it **Photo of child** (anything starting with *Photo of child*, *Child's photo* or *Photo* works; do not leave it as "Untitled"). Add a hint such as *a clear photo of the child's face*.
3. Set **Maximum number of files: 1**, **Maximum file size: 10 MB**, allowed type **Image**. Leave it **not required**, so a child with no photo can still register.
4. Google will now make parents **sign in to a Google account** to submit the Form, and the photos are stored in the Foundation's Google Drive in a folder called *"<Form name> (File responses)"*. Tell parents this in the invitation, and use the Form's *Settings* to avoid collecting e-mail addresses you don't need.
5. **Photos of children with a medical condition are sensitive.** Keep that Drive folder private, share it only with the Foundation's own people and the CHRS robot (below), and delete it after camp as part of the retention plan.

### Let CHRS download the photos (once)

The sheet only holds a *link* to each photo. To download them, CHRS needs permission to read that folder:

1. In Google Cloud (§3), also enable the **Google Drive API** (APIs & Services → Library → *Google Drive API* → Enable). No new key is needed: the same service account is used.
2. In Google Drive open the **"… (File responses)"** folder → **Share** → paste the service account's e-mail (`…@….iam.gserviceaccount.com`) → **Viewer**. Photos uploaded later land in this folder and inherit the sharing.

Without these two steps everything else still works. Children are simply imported without photos, and the physician adds them by hand (below).

## 2. Link the Form to a Sheet (once)

In the Form: **Responses → Link to Sheets → Create a new spreadsheet.** The tab is normally called `Form Responses 1`. If it is renamed, put the new name in the laptop config (§4).

Staff may add their own columns to the sheet (e.g. "Checked by"). They are ignored and never affect syncing.

## 3. Create the read-only Google "robot" account (once per organisation)

This lets the laptops read the sheet **without publishing it to the web** and without anyone signing in with a personal Google account.

1. Go to <https://console.cloud.google.com> → create a project (e.g. `chrs-sync`).
2. **APIs & Services → Library →** enable **Google Sheets API**.
3. **IAM & Admin → Service Accounts → Create service account** (e.g. `chrs-sheet-reader`). No roles are needed.
4. Open it → **Keys → Add key → Create new key → JSON.** A `.json` file downloads. This file is the password. Treat it like one.
5. Open the responses Sheet → **Share** → paste the service account's email (`…@….iam.gserviceaccount.com`) → role **Viewer**.
6. *(Only if parents upload photos.)* Also enable the **Google Drive API** and share the Form's upload folder with the same email. See "Let CHRS download the photos" in §1.

## 4. Set up a laptop (once per laptop)

In CHRS's data folder (the one that contains `chrs.db`, usually `%APPDATA%\chrs`), add two files:

**`service-account.json`**: the key file from step 3.4.

**`google-sync.json`**:
```json
{
  "spreadsheetId": "PASTE THE SHEET'S ID OR ITS FULL URL",
  "sheetName": "Form Responses 1",
  "serviceAccountKeyFile": "service-account.json"
}
```
(The ID is the long text in the sheet's address: `docs.google.com/spreadsheets/d/<ID>/edit`.)

Reopen the CHRS dashboard (restart the app if it still shows the notice). The **Sync registrations from Google Sheet** card (Administrator and Physician roles) will no longer say it's not set up. For development, the same settings can be given as the `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB` and `GOOGLE_SERVICE_ACCOUNT_FILE` environment variables (see `.env.example`).

## 5. Day-to-day use

1. Check the **Camp session date**. It is applied to every newly synced child (and remembered between launches), unless the sheet has its own *Camp session date* column.
2. Press **Sync now**. If new children uploaded photos, CHRS first downloads exactly those photos (the button shows *Downloading photos… 3 of 12*), shrinks them to small thumbnails, then imports each child with their photo.
   - If the photos **cannot** be downloaded (no Drive access, Drive API off, offline) **nothing is imported yet** and you are told why. Fix it and press Sync again, or press **Import without photos** and add them by hand afterwards. This stops a whole camp being imported photo-less by accident, because a later sync cannot attach a photo to a child already in CHRS.
   - A single missing or unreadable photo does not stop the sync: that child is imported without a photo and listed in the result.
3. Read the result:

| Message | Meaning |
|---|---|
| **N new children added** | New registrations now in CHRS, searchable immediately. |
| **N already synced earlier** | Rows from previous syncs, skipped. |
| **N already in CHRS (not duplicated)** | The child was already in CHRS (added by hand or via CSV) or was submitted twice on the Form. Same first name + surname + date of birth + session date. |
| **Sheet row N could not be imported** | The row is missing something required (name, valid date of birth, consent). Fix it **in the sheet** and press Sync again. It will be picked up. |
| **Sheet row N changed after it was imported** | Someone edited the sheet after the child was synced. CHRS does **not** overwrite existing records. Check the child's profile (especially allergies and medication) against the sheet and correct it in CHRS. |
| **N children were added without a photo** | No photo was uploaded, or it could not be downloaded or read. The physician can add it (see "Changing a child's photo"). |
| **Not imported (column not recognised)** | A sheet column's title doesn't match the table in §1. Often a typo, e.g. `Alergies`. Fix the Form question title. |

## 6. Offline alternative: import a downloaded CSV

Use this when a laptop has no internet or the Google setup (§3-4) isn't done. It needs no Google account on the laptop and uses the same duplicate protection as **Sync now**, so the two routes can be mixed safely.

1. On any computer with internet, open the response Sheet and choose **File > Download > Comma-separated values (.csv)**. Copy the file to the laptop (USB stick is fine). **Do not open it in Excel and save it again.** Excel drops the leading `0` from phone numbers.
2. In CHRS, find **Import registrations from a downloaded file (offline)** on the dashboard. Check the **Camp session date**, then choose the CSV.
3. Read the preview table. Nothing is saved yet. Each row says *Will be added*, *Already in CHRS*, or why it *cannot be imported* (for example an ambiguous date such as `03/04/2012`: re-enter it as `2012-04-03` in the sheet and download again).
4. Press **Import**. You can import a newer download of the same sheet later: only new responses are added, whatever the file is called.

### Photos

A downloaded CSV has the same **Photo** column the Form's upload question fills in. It holds one of two things, and the import card handles both:

**Parent uploads (Google Drive links).** The cell contains a link like `https://drive.google.com/open?id=…`. In the import card press **Download N photos from Google Drive**. This one step needs internet and the Drive set-up from §1 on this laptop. After it finishes the preview shows *Photo found*. If you skip it (no internet), the children are imported without photos and the physician adds them later.

**File names (fully offline).** Type the **file name** of each child's picture in the Photo column (e.g. `thandi-nkosi.jpg`), put the picture files in one folder (JPG, PNG or WebP; iPhone HEIC files must be converted first), then in the import card choose **Choose photo files** or **Choose a photo folder**. File names are matched ignoring capital letters.

Rules worth knowing:
- **No photo means a blank photo.** An empty cell, a file name that isn't among the chosen photos, a Drive photo that wasn't downloaded, any other web link, or a damaged picture all leave the child's photo blank. The child is still imported, and the preview warns you first.
- Photos are matched by the exact file name or Drive file ID in the cell, never guessed from the child's name. If two chosen files share a name, both are skipped. If a parent uploaded several photos, the first is used.
- **A photo can only be attached by an import when the child is first imported.** Importing again will not add it to a child who is already in CHRS. Use *Changing a child's photo* below for those.
- Pictures are shrunk to small thumbnails on the laptop and stored in the encrypted database. The only thing downloaded from Google is the photo itself.

## 7. Changing a child's photo (physician)

Open the child's record (search by ID or name). The photo is shown at the top of the record for everyone who can view it, with a grey *No photo* box if there is none.

The **camp physician** also sees **Add photo / Change photo** and **Remove**. Choose a picture from the laptop (JPG or PNG; it is shrunk automatically) and it is saved at once. Nurses, counselors and the administrator can see photos but cannot change them; this is enforced by CHRS itself, not just by hiding the buttons.

Every change is written to the audit log with the before and after record, so a replaced or removed photo can always be recovered from the audit trail. Removing a photo leaves the child with no photo (never a placeholder).

## Troubleshooting

| Message | Fix |
|---|---|
| *Couldn't reach Google…* | No internet. Try again when online. Nothing was changed. |
| *…can't read the sheet. Share the responses sheet with …* | Do step 3.5, or confirm the Sheets API is enabled (3.2). |
| *The photo was not found, or it is not shared with …* | Share the Form's *"… (File responses)"* folder in Drive with that address as Viewer (§1). |
| *The Google Drive API is not switched on…* | Enable the Google Drive API in the Google Cloud project (3.6). |
| *Photo is on Google Drive and has not been downloaded yet* | Press **Download photos from Google Drive** (CSV card), or Sync now with internet. |
| *Google rejected the service-account key…* | Check the laptop's **date and time** are correct (a wrong clock is the usual cause), then that the key still exists in Google Cloud. |
| *The tab "…" does not exist* | `sheetName` in `google-sync.json` doesn't match the tab's name. |
| *The sheet is missing required column(s)…* | A required question title (§1) is missing or misspelled. |
| *…has not been set up on this laptop yet* | Do §4. |

If the internet is unavailable for the whole camp, download the sheet as CSV elsewhere and use the **Import registrations from a downloaded file (offline)** card (§6). It works offline.

## Security notes

- The key file grants **read-only** access to this one sheet (never write), and can be revoked at any time by un-sharing the sheet or deleting the key in Google Cloud.
- Anyone with the Foundation's Google account access can see the children's medical answers in the sheet. Restrict who the sheet is shared with, and agree a retention/deletion plan for the sheet after camp as part of POPIA compliance.
- CHRS reads the sheet from its main process only; the key and tokens never reach the screen/renderer, and sync results shown on screen contain row numbers and counts, not children's details.
