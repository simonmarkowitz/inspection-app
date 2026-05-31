const express = require('express');
const multer = require('multer');
const sgMail = require('@sendgrid/mail');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
require('dotenv').config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const uploadPath = process.env.UPLOAD_PATH || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
const storage = multer.diskStorage({ destination: (req, file, cb) => cb(null, uploadPath), filename: (req, file, cb) => { const unique = Date.now() + '-' + Math.round(Math.random() * 1e9); cb(null, unique + path.extname(file.originalname)); } });
const upload = multer({ storage });
async function uploadToDrive(filePath, filename, unit) {
  try {
    const credentials = process.env.GOOGLE_CREDENTIALS ? JSON.parse(process.env.GOOGLE_CREDENTIALS) : JSON.parse(fs.readFileSync(path.join(__dirname, 'credentials.json')));
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/drive'] });
    const drive = google.drive({ version: 'v3', auth });
    const folderRes = await drive.files.list({ q: "name='Unit " + unit + "' and mimeType='application/vnd.google-apps.folder' and '" + process.env.DRIVE_FOLDER_ID + "' in parents and trashed=false", fields: 'files(id, name)', supportsAllDrives: true, includeItemsFromAllDrives: true, driveId: process.env.DRIVE_FOLDER_ID, corpora: 'drive' });
    let unitFolderId;
    if (folderRes.data.files.length > 0) { unitFolderId = folderRes.data.files[0].id; }
    else { const newFolder = await drive.files.create({ requestBody: { name: 'Unit ' + unit, mimeType: 'application/vnd.google-apps.folder', parents: [process.env.DRIVE_FOLDER_ID] }, fields: 'id', supportsAllDrives: true, driveId: process.env.DRIVE_FOLDER_ID }); unitFolderId = newFolder.data.id; }
    const fileRes = await drive.files.create({ requestBody: { name: filename, parents: [unitFolderId] }, media: { mimeType: 'image/jpeg', body: fs.createReadStream(filePath) }, fields: 'id, webViewLink', supportsAllDrives: true });
    return fileRes.data.webViewLink;
  } catch (err) { console.error('Drive upload error:', err.message); return null; }
}
app.post('/upload', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ filename: req.file.filename, path: req.file.path });
});
app.post('/send-report', async (req, res) => {
  const { unit, tenant, inspector, inspectorEmail, officeEmail, damages } = req.body;
  let html = '<h2>Inspection Report</h2>';
  html += '<p><b>Unit:</b> ' + unit + '</p>';
  html += '<p><b>Tenant:</b> ' + tenant + '</p>';
  html += '<p><b>Inspector:</b> ' + inspector + '</p>';
  html += '<p><b>Date:</b> ' + new Date().toLocaleDateString() + '</p>';
  html += '<h3>Damages</h3>';
  html += '<table border="1" cellpadding="6" cellspacing="0">';
  html += '<tr><th>Room</th><th>Damage</th><th>Charge</th><th>Notes</th><th>Photo</th></tr>';
  let total = 0;
  const attachments = [];
  for (const d of damages) {
    let driveLink = '';
    if (d.filename) {
      const filePath = path.join(uploadPath, d.filename);
      if (fs.existsSync(filePath)) {
        const fileData = fs.readFileSync(filePath);
        attachments.push({ content: fileData.toString('base64'), filename: d.filename, type: 'image/jpeg', disposition: 'attachment' });
        const link = await uploadToDrive(filePath, d.filename, unit);
        if (link) driveLink = '<a href="' + link + '">View Photo</a>';
      }
    }
    html += '<tr><td>' + d.room + '</td><td>' + d.damage + '</td><td>$' + d.price + '</td><td>' + (d.notes || '') + '</td><td>' + driveLink + '</td></tr>';
    total += parseFloat(d.price) || 0;
  }
  html += '<tr><td colspan="3"><b>Total</b></td><td><b>$' + total.toFixed(2) + '</b></td><td></td></tr></table>';
  const confirmHtml = '<h2>Report Confirmation</h2><p>Hi ' + inspector + ',</p><p>Report for Unit ' + unit + ' submitted.</p><p>Tenant: ' + tenant + '</p><p>Date: ' + new Date().toLocaleDateString() + '</p><p>Damages: ' + damages.length + '</p><p>Total: $' + total.toFixed(2) + '</p><p>Report and photos sent to office and uploaded to Google Drive.</p>';
  try {
    if (!officeEmail) throw new Error('No office email provided');
    await sgMail.send({ from: process.env.EMAIL_FROM, to: officeEmail, subject: 'Inspection Report - Unit ' + unit, html: html, attachments: attachments });
    if (inspectorEmail) await sgMail.send({ from: process.env.EMAIL_FROM, to: inspectorEmail, subject: 'Confirmation - Report sent for Unit ' + unit, html: confirmHtml });
    res.json({ success: true });
  } catch (err) { console.error(err.response ? err.response.body : err); res.status(500).json({ error: err.message }); }
});
app.listen(process.env.PORT || 3001, function() { console.log('Inspection server running on port ' + (process.env.PORT || 3001)); console.log('Upload folder: ' + uploadPath); });