// Google Apps Script. Run setupWebsiteForm() once, signed in to the Google account that should own the form
// (a test account first, then Sudipta's). It creates the "Update my website" form, its answers sheet (view-only by
// link, so the website can read it), a "Mindful Monkey website" Drive folder holding both, and an on-submit trigger
// that (1) shares uploaded photos view-only by link so the website can copy them and (2) emails a copy to Pranav.
// Question titles must match sync-content.js exactly.
//
// AFTER RUNNING: Apps Script cannot create file-upload questions, so add these two by hand in the form editor
// (question type "File upload", allow only images, 1 file, 10 MB), as the LAST question of its section:
//   - in "Add an article I read":                  title  Article photo (optional)
//   - in "Add a bootcamp, retreat or workshop":    title  Event photo (optional)
const NOTIFY = "pranavayyar2712@gmail.com";

function setupWebsiteForm() {
  const form = FormApp.create("Update my website");
  form.setTitle("Update my website · Mindful Monkey")
    .setDescription("Add an article, interview, video, event or testimonial, change a price or batch date, or take something off mindfulmonkeycoach.com.\nPick one thing per submission. Your website updates itself within about an hour.")
    .setCollectEmail(false).setAllowResponseEdits(false).setShowLinkToRespondAgain(true).setProgressBar(false)
    .setConfirmationMessage("Thank you! Your website will update within about an hour. Tap 'Submit another response' to add something else.");

  const what = form.addMultipleChoiceItem().setTitle("What do you want to update?").setRequired(true);
  const url = (help) => FormApp.createTextValidation().requireTextIsUrl().setHelpText(help || "Please paste a full link starting with https://").build();
  const nums = FormApp.createTextValidation().requireNumberBetween(1, 10000000).setHelpText("Please type only numbers, like 24000").build();

  const pArticle = form.addPageBreakItem().setTitle("Add an article I read").setHelpText("It appears under \"Articles I read\" on the About page, with the article's own picture.");
  form.addTextItem().setTitle("Article link").setHelpText("Open the article, copy the link from the address bar or Share button, and paste it here.").setRequired(true).setValidation(url());
  form.addTextItem().setTitle("Article title (optional)").setHelpText("Leave empty to use the article's own title.");
  form.addParagraphTextItem().setTitle("A line about it (optional)").setHelpText("One sentence shown under the title. Leave empty to use the article's own summary.");

  const pPress = form.addPageBreakItem().setTitle("Add an interview or press link").setHelpText("It appears at the top of \"In the press\" on the About page.");
  form.addTextItem().setTitle("Interview or press link").setRequired(true).setValidation(url());
  form.addTextItem().setTitle("How should it read on the website? (optional)").setHelpText("For example: The Hindu: Sudipta on starting parkour at 30. Leave empty and the website writes it from the article.");

  const pVideo = form.addPageBreakItem().setTitle("Add a YouTube video");
  form.addTextItem().setTitle("YouTube link").setHelpText("Open the video on YouTube, tap Share, then Copy link, and paste it here.").setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextMatchesPattern(".*youtu.*").setHelpText("Please paste a YouTube link").build());
  form.addCheckboxItem().setTitle("Where should it show?").setRequired(true).setChoiceValues(["Home page", "About page", "Courses page", "Group Classes page", "Testimonials page"]);
  form.addTextItem().setTitle("Short title (optional)").setHelpText("Leave empty to use the YouTube title.");

  const pEvent = form.addPageBreakItem().setTitle("Add a bootcamp, retreat or workshop").setHelpText("It appears as a card under \"Upcoming bootcamps, retreats and workshops\" on the Courses page, and comes off by itself after the last day.");
  form.addMultipleChoiceItem().setTitle("What is it?").setRequired(true).setChoiceValues(["Bootcamp", "Retreat", "Workshop"]);
  form.addTextItem().setTitle("Name of the event").setHelpText("Short, like: Back to Your Roots").setRequired(true);
  form.addTextItem().setTitle("Dates and time").setHelpText("As it should read, like: 12 to 15 Feb 2027, or Every Saturday in January, 7 AM").setRequired(true);
  form.addDateItem().setTitle("Last day of the event").setHelpText("The card is taken off the website after this day.").setRequired(true);
  form.addTextItem().setTitle("Where?").setHelpText("Like: North Goa, or Online on Zoom").setRequired(true);
  form.addTextItem().setTitle("Price in ₹ (optional, numbers only)").setHelpText("Leave empty if you don't want to show a price.").setValidation(nums);
  form.addTextItem().setTitle("Price note (optional)").setHelpText("Like: per person, stay included");
  form.addParagraphTextItem().setTitle("Describe it in 1 to 3 sentences").setHelpText("Written exactly as you want it on the website.").setRequired(true);

  const pTesti = form.addPageBreakItem().setTitle("Add a testimonial");
  form.addTextItem().setTitle("Client's first name").setRequired(true);
  form.addTextItem().setTitle("Their age (optional)");
  form.addTextItem().setTitle("Their city (optional)");
  form.addListItem().setTitle("Which course did they do?").setRequired(true).setChoiceValues(["LEAP", "Playsophy", "Group Classes", "Discovery Call", "Personal coaching"]);
  form.addParagraphTextItem().setTitle("What did they say?").setHelpText("Paste their words exactly as they wrote them.").setRequired(true);
  form.addTextItem().setTitle("YouTube link of their video (optional)");

  const pPrice = form.addPageBreakItem().setTitle("Change a price");
  form.addListItem().setTitle("Which price?").setRequired(true).setChoiceValues([
    "LEAP", "Playsophy (early bird)", "Playsophy (regular)", "Group Classes: drop-in", "Group Classes: 6 sessions",
    "Group Classes: 8 sessions", "Group Classes: 10 sessions", "Group Classes: 12 sessions", "Discovery Call", "Consultation Call"]);
  form.addTextItem().setTitle("New price in ₹ (numbers only)").setHelpText("For example: 24000").setRequired(true)
    .setValidation(FormApp.createTextValidation().requireNumberBetween(100, 10000000).setHelpText("Please type only numbers, like 24000").build());

  const pBatch = form.addPageBreakItem().setTitle("Change a batch date");
  form.addListItem().setTitle("Which course?").setRequired(true).setChoiceValues(["LEAP", "Playsophy", "Group Classes"]);
  form.addTextItem().setTitle("When does the next batch start?").setHelpText("For example: 5 January 2027. Type NONE to take the date off the website.").setRequired(true);

  const pRemove = form.addPageBreakItem().setTitle("Remove something");
  form.addListItem().setTitle("What should come off the website?").setRequired(true).setChoiceValues([
    "A bootcamp, retreat or workshop", "An article I read", "An interview or press link", "A YouTube video", "A testimonial"]);
  form.addTextItem().setTitle("Paste its link, or type its name or title exactly").setHelpText("For an event or testimonial, type the event name or the client's first name. For anything else, paste the same link you used.").setRequired(true);

  what.setChoices([
    what.createChoice("Add an article I read", pArticle), what.createChoice("Add an interview or press link", pPress),
    what.createChoice("Add a YouTube video", pVideo), what.createChoice("Add a bootcamp, retreat or workshop", pEvent),
    what.createChoice("Add a testimonial", pTesti), what.createChoice("Change a price", pPrice),
    what.createChoice("Change a batch date", pBatch), what.createChoice("Remove something", pRemove)]);
  // each section ends the form instead of running into the next one
  [pPress, pVideo, pEvent, pTesti, pPrice, pBatch, pRemove].forEach(function (p) { p.setGoToPage(FormApp.PageNavigationType.SUBMIT); });

  const ss = SpreadsheetApp.create("Website updates (form answers)");
  ss.setSpreadsheetLocale("en_GB"); // dates arrive as dd/mm/yyyy, which sync-content.js expects
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush(); Utilities.sleep(4000);
  const sheet = SpreadsheetApp.openById(ss.getId()).getSheets().filter(function (s) { return s.getFormUrl(); })[0];
  const blank = ss.getSheetByName("Sheet1"); if (blank && sheet) ss.deleteSheet(blank);
  DriveApp.getFileById(ss.getId()).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const folder = DriveApp.createFolder("Mindful Monkey website");
  DriveApp.getFileById(form.getId()).moveTo(folder);
  DriveApp.getFileById(ss.getId()).moveTo(folder);

  ScriptApp.newTrigger("onWebsiteFormSubmit").forForm(form).onFormSubmit().create();

  const out = {
    formLink: form.shortenFormUrl(form.getPublishedUrl()),
    formEdit: form.getEditUrl(),
    sheet: ss.getUrl(),
    csvUrl: "https://docs.google.com/spreadsheets/d/" + ss.getId() + "/export?format=csv&gid=" + sheet.getSheetId(),
  };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// If setupWebsiteForm stopped partway (usually the "run when you're not present" permission box was left unticked),
// run this instead of running setup again: it reuses the form and sheet already in the "Mindful Monkey website"
// folder, (re)creates the on-submit trigger and logs the same links.
function finishSetup() {
  const folder = DriveApp.getFoldersByName("Mindful Monkey website").next();
  const form = FormApp.openById(folder.getFilesByType(MimeType.GOOGLE_FORMS).next().getId());
  const ss = SpreadsheetApp.openById(folder.getFilesByType(MimeType.GOOGLE_SHEETS).next().getId());
  DriveApp.getFileById(ss.getId()).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("onWebsiteFormSubmit").forForm(form).onFormSubmit().create();
  const sheet = ss.getSheets().filter(function (s) { return s.getFormUrl(); })[0];
  const out = {
    formLink: form.shortenFormUrl(form.getPublishedUrl()),
    formEdit: form.getEditUrl(),
    sheet: ss.getUrl(),
    csvUrl: "https://docs.google.com/spreadsheets/d/" + ss.getId() + "/export?format=csv&gid=" + sheet.getSheetId(),
  };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

function onWebsiteFormSubmit(e) {
  const lines = [];
  e.response.getItemResponses().forEach(function (r) {
    const item = r.getItem(), a = r.getResponse();
    if (item.getType() === FormApp.ItemType.FILE_UPLOAD) {
      // let the website copy the photo (view-only by link); the file stays in this Drive
      (a || []).forEach(function (id) { try { DriveApp.getFileById(id).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) { lines.push("Could not share photo " + id + ": " + err); } });
      lines.push(item.getTitle() + ": " + (a || []).map(function (id) { return "https://drive.google.com/open?id=" + id; }).join(", "));
    } else lines.push(item.getTitle() + ": " + (Array.isArray(a) ? a.join(", ") : a));
  });
  MailApp.sendEmail(NOTIFY, "Website update: " + (lines[0] || "").replace(/^[^:]*:\s*/, ""),
    lines.join("\n") + "\n\nThis goes live on the website within about an hour.\nTo undo it, delete the row in the answers sheet (or submit \"Remove something\").");
}
