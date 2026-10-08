/**
 * Creates the CHRS camper-registration Google Form AND the Google Sheet that
 * collects its answers, with the exact question titles the CHRS "Sync now"
 * button looks for (see docs/GOOGLE_SHEET_SYNC.md).
 *
 * HOW TO RUN (2 minutes, once per camp)
 *   1. Go to https://script.google.com  ->  New project.
 *   2. Delete the sample code, paste this whole file in, and Save.
 *   3. Edit the CONFIG block below (camp name, dates, venue, deadline).
 *   4. Pick  createRegistrationForm  in the function drop-down and click Run.
 *   5. Approve the permission prompt (it is YOUR script touching YOUR Drive;
 *      Google shows an "unverified app" notice for any personal script:
 *      Advanced -> Go to project).
 *   6. Open  View -> Logs  for the links to the Form and the Sheet.
 *
 * PHOTO UPLOAD: Apps Script cannot create a file-upload question, so add it by
 * hand afterwards (Form editor -> Add question -> File upload, titled
 * "Photo of child", 1 file, images only, not required). CHRS picks the photos up
 * from the Drive links in the sheet. See docs/GOOGLE_SHEET_SYNC.md, section 1.
 *
 * Run it once. Running it again creates a second, separate Form and Sheet.
 * DON'T rename the question titles afterwards; CHRS finds columns by title.
 */

const CONFIG = {
  campName: 'JFF Camp #117',
  campDates: '29 June to 3 July 2026',
  campVenue: 'WESSA Twinstreams Environmental Education Centre in Mtunzini in KwaZulu Natal',
  returnBy: '12 June 2026',
  formTitle: 'JFF Camp #117: Camper Registration',
  spreadsheetTitle: 'JFF Camp #117: Registrations (CHRS sync)',
};

// Question titles are the contract with CHRS. Do not change them.
// Each entry: section | header (read-only text) | a question.
const SPEC = [
  { section: 'Personal information', help: 'To be completed in full.' },
  { q: 'text', title: "Child's name", required: true },
  { q: 'text', title: 'Surname', required: true },
  { q: 'date', title: 'Date of birth', required: true },
  { q: 'choice', title: 'Sex', choices: ['Female', 'Male', 'Other'] },
  { q: 'text', title: 'T-shirt size' },
  { q: 'paragraph', title: 'Address' },
  { q: 'text', title: 'Cell number', phone: true, help: "The child's own number, if they have one. Example: 082 123 4567" },
  { q: 'text', title: 'Language spoken' },

  { section: 'Parent / Primary Caregiver and emergency contact' },
  { q: 'text', title: 'Parent/Primary Caregiver name and surname', required: true },
  { q: 'text', title: 'Parent/Primary Caregiver cell number', required: true, phone: true, help: 'Example: 082 123 4567' },
  { header: 'Emergency contact', text: 'In case of an emergency, should we not get hold of the Parent/Primary Caregiver, who must we contact?' },
  { q: 'text', title: 'Emergency contact name', required: true },
  { q: 'text', title: 'Emergency contact cell number', required: true, phone: true, help: 'Example: 082 123 4567' },
  { q: 'text', title: 'Emergency contact relationship to child', help: 'For example: "Aunt"' },

  { section: 'Medical information', help: 'STRICTLY CONFIDENTIAL. To be filled in by the Primary Caregiver.' },
  { q: 'text', title: 'Diagnosis', required: true },
  { q: 'text', title: 'Clinic/Hospital file number' },
  { q: 'paragraph', title: 'Clinic/Hospital/Doctor contact details', help: 'Where the child receives treatment.' },
  { q: 'paragraph', title: 'Allergies', required: true, help: 'List every allergy (food, medicine, insect stings...), separated by commas or new lines. Write "None" if there are none.' },
  { q: 'paragraph', title: 'Current medication', help: 'Please list, ONE MEDICATION PER LINE (press Enter between medications), with the dose if you know it.' },
  { q: 'choice', title: 'Medication handed in', choices: ['Yes', 'No'] },
  { q: 'choice', title: 'Viral load > 1000 copies/ml', choices: ['Yes', 'No'] },
  { q: 'checkbox', title: 'TB history', choices: ['Current', 'Past', 'Negative', 'On treatment'] },
  { q: 'choice', title: 'Hepatitis B', choices: ['Yes', 'No'] },
  { q: 'paragraph', title: 'Adherence barriers', help: 'If there are any, list the details. Otherwise write "No".' },
  { q: 'paragraph', title: 'Dietary requirements', help: 'For example: diabetic, religious, kosher, halaal, vegetarian.' },
  { q: 'text', title: 'Religion', help: "The camper's religious affiliation." },
  { q: 'paragraph', title: 'Additional information to disclose', help: 'If further details are provided, additional forms may need to be completed.' },
  { q: 'paragraph', title: 'Additional camper information', help: 'Any additional camper information, history, suggestions or limitations (behavioural history, psychosocial needs, self-care needs such as bedwetting or sleepwalking).' },

  { section: 'Consent and indemnity', help: 'Please read each statement carefully before ticking the box.' },
  { header: 'Consent to disclosure of clinical records', text: () =>
      'I consent to disclosure of my clinical records to Just Footprints Foundation (JFF). I understand the details will make my camp experience pleasant and ensure adherence and safety of other campers. I consent to my details and results being used by JFF for service delivery, follow-up, referral and data collection purposes, provided that confidentiality is respected. I will not hold any healthcare professional who discloses my clinical records to JFF for the purpose of camp service delivery.' },
  { q: 'checkbox', title: 'Consent to disclosure', required: true, choices: ['I consent'], help: 'Required. A child cannot be registered without this consent.' },

  { header: 'Photographic / filming sessions: Media release', text: () =>
      'JFF may utilize photos and videos taken of my child for media releases as well as social media platforms. I understand my child\u2019s name may be used in connection with these materials. By agreeing to this media release, I intend to legally bind myself. Camp Footprints and SeriousFun Children\u2019s Network shall have the right to use photographs or other images of me in promotional, educational or fundraising materials, the media and on social media platforms. I acknowledge that Just Footprints Foundation through Camp Footprints and SeriousFun Children\u2019s Network shall have all rights of copyright in and to such photographs and videos and may use such copyright fully.\n\nThis consent is voluntary, and I give it in the interest of public information, education, the furtherance of the goals of these organisations, or other lawful purposes. I acknowledge that I have legal authority to agree to this.' },
  { q: 'checkbox', title: 'Media release', choices: ['I agree to the media release'] },

  { header: 'Indemnity: attendance and participation', text: () =>
      'I/We, the Parents/Legal Guardians/Primary Caregiver of the minor child named in this form, do hereby consent to my/our child attending the Camp Footprints Camp to be held at the ' + CONFIG.campVenue + ' from ' + CONFIG.campDates + '. I/we further consent to my/our child participating in all camp activities, excursions, and any travel to entertainment venues, informal and group and outings arranged by the organisers of the aforesaid camp entirely at his/her own risk. In this regard I/we transfer all contractual liability to him/her.' },
  { header: 'Indemnity: liability, authority and privacy', text: () =>
      'I/we hereby agree that neither the child nor guardians shall have any claim whatsoever and indemnify and hold harmless The Just Footprints Foundation and/or WESSA Twinstreams Environmental Education Centre, or any individual organiser of the camp, or the organising body, or any sponsor against any loss or damage or from any claim or action of whatsoever for physical injury of otherwise, suffered by the child or caregiver or by any other third party, arising from his/her participation in such camp and regardless of whether or not same shall have been caused by any omission or the negligence of the aforementioned individual, organizing body or sponsor. We authorize any member of the Board of Just Footprints Foundation or the appointed Camp Director to act in loco of parents for the duration of Camp Footprints and to sign any indemnity or consent required by any third person.\n\nI do hereby agree that my child shall participate in the Camp Footprints and or WESSA Twinstreams Environmental Education Centre program organised by the leadership team on the above-mentioned terms and conditions and voluntarily assume all risks inherent therein.\n\nWe are very aware of our obligations under the POPI Act, and we undertake not to collect your information without a purpose and not to disclose your information to other parties.\n\nI/we are aware that every possible precaution will be taken to ensure maximum safety and wellbeing of my/our child.' },
  { q: 'checkbox', title: 'Indemnity agreement', required: true, choices: ['I agree to the indemnity'] },
  { q: 'text', title: 'Parent/guardian full name', required: true, help: 'Type your full name. By submitting this form you confirm that you are the parent / legal guardian / primary caregiver and have legal authority to give the consents above.' },
];

function createRegistrationForm() {
  const form = FormApp.create(CONFIG.formTitle);

  form.setDescription(
    CONFIG.campName + ' | ' + CONFIG.campDates + '\n' +
    'Please complete the following information. Please submit by ' + CONFIG.returnBy + '.\n\n' +
    'One form per child. Have more than one child attending? Use "Submit another response" at the end.\n\n' +
    'NOTE: The number of children we can accept at camp is restricted. Camp Footprints has a no smoking, NO drugs, NO alcohol policy.\n\n' +
    'We are very aware of our obligations under the POPI Act, and we undertake not to collect your information without a purpose and not to disclose your information to other parties.'
  );
  form.setConfirmationMessage('Thank you. Your registration has been received. Please remember that the indemnity must also be returned to the Camp Director if requested.');
  form.setProgressBar(true);
  form.setShowLinkToRespondAgain(true);          // siblings: one response per child
  trySetting_(function () { form.setCollectEmail(false); });
  trySetting_(function () { form.setRequireLogin(false); });   // parents need no Google account
  trySetting_(function () { form.setLimitOneResponsePerUser(false); });
  trySetting_(function () { form.setAllowResponseEdits(false); });

  const phoneTitles = [];
  let firstSection = true;

  SPEC.forEach(function (entry) {
    if (entry.section) {
      if (firstSection) { form.addSectionHeaderItem().setTitle(entry.section).setHelpText(entry.help || ''); firstSection = false; }
      else { form.addPageBreakItem().setTitle(entry.section).setHelpText(entry.help || ''); }
    } else if (entry.header) {
      const text = typeof entry.text === 'function' ? entry.text() : entry.text;
      form.addSectionHeaderItem().setTitle(entry.header).setHelpText(text);
    } else {
      addQuestion_(form, entry);
      if (entry.phone) phoneTitles.push(entry.title);
    }
  });

  // The Sheet that receives the answers.
  const ss = SpreadsheetApp.create(CONFIG.spreadsheetTitle);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  const responses = waitForResponsesSheet_(ss.getId());
  if (responses) {
    keepPhoneNumbersAsText_(responses, phoneTitles);
    removeEmptyDefaultSheet_(ss.getId());
  }

  Logger.log('FORM (edit it here):        ' + form.getEditUrl());
  Logger.log('FORM (send this to parents): ' + form.getPublishedUrl());
  Logger.log('SHEET:                       ' + ss.getUrl());
  Logger.log('Spreadsheet ID for CHRS google-sync.json: ' + ss.getId());
  Logger.log('Responses tab name: ' + (responses ? responses.getName() : '(not found yet: check the Sheet and note the exact tab name)'));
  Logger.log(responses
    ? 'Phone columns were set to Plain text. Now submit ONE test response and confirm leading zeros survive, then delete the test row.'
    : 'Could not format the sheet automatically. Open the Sheet, select the three phone-number columns and choose Format > Number > Plain text.');
}

function addQuestion_(form, q) {
  let item;
  switch (q.q) {
    case 'text': item = form.addTextItem(); break;
    case 'paragraph': item = form.addParagraphTextItem(); break;
    case 'date': item = form.addDateItem().setIncludesYear(true); break;
    case 'choice': item = form.addMultipleChoiceItem(); break;
    case 'checkbox': item = form.addCheckboxItem(); break;
    default: throw new Error('Unknown question type: ' + q.q);
  }
  item.setTitle(q.title);
  if (q.help) item.setHelpText(q.help);
  if (q.choices) item.setChoices(q.choices.map(function (c) { return item.createChoice(c); }));
  if (q.phone) {
    item.setValidation(FormApp.createTextValidation()
      .setHelpText('Please enter a phone number using digits only (spaces, + and - are fine).')
      .requireTextMatchesPattern('^\\+?[0-9 ()\\-]{9,16}$')
      .build());
  }
  item.setRequired(Boolean(q.required));
}

// Forms writes responses into a tab it creates a moment after linking.
function waitForResponsesSheet_(spreadsheetId) {
  for (let attempt = 0; attempt < 8; attempt++) {
    SpreadsheetApp.flush();
    const sheets = SpreadsheetApp.openById(spreadsheetId).getSheets()
      .filter(function (s) { return /^Form Responses/.test(s.getName()); });
    if (sheets.length && sheets[0].getLastColumn() > 0) return sheets[0];
    Utilities.sleep(1500);
  }
  return null;
}

// Sheets turns "0821234567" into the number 821234567 and drops the zero.
// Plain-text formatting on the column stops that.
function keepPhoneNumbersAsText_(sheet, phoneTitles) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  phoneTitles.forEach(function (title) {
    const col = headers.indexOf(title) + 1;
    if (col > 0) sheet.getRange(2, col, rows, 1).setNumberFormat('@');
  });
}

function removeEmptyDefaultSheet_(spreadsheetId) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);
}

// Some settings are only available on Google Workspace accounts.
function trySetting_(fn) { try { fn(); } catch (e) { Logger.log('Skipped a setting: ' + e.message); } }
