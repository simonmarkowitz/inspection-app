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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadPath),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

async function uploadToDrive(filePath, filename, unit) {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: path.join(__dirname, 'credentials.json'),
      scopes: ['https://www.googleapis.com/auth/drive.file']
    });
    const drive = google.drive({ version: 'v3', auth });

    // Find or create a subfolder for the unit
    const folderRes = await drive.files.list({
      q: `name='Unit ${unit}' and mimeType='application/vnd.google-apps.folder' and '${process.env.DRIVE_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id, name)'
    });

    let unitFolderId;
    if (folderRes.data.files.length > 0) {
      unitFolderId = folderRes.data.files[0].id;
    } else {
      const newFolder = await drive.files.create({
        requestBody: {
          name: `Unit ${unit}`,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [process.env.DRIVE_FOLDER_ID]
        },
        fields: 'id'
      });
      unitFolderId = newFolder.data.id;
    }

    const fileRes = await drive.files.create({
      requestBody: {
        name: filename,
        parents: [unitFolderId]
      },
      media: {
        mimeType: 'image/jpeg',
        body: fs.createReadStream(filePath)
      },
      fields: 'id, webViewLink'
    });

    return fileRes.data.webViewLink;
  } catch (err) {
    console.error('Drive upload error:', err);
    return null;
  }
}

app.post('/upload', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ filename: req.file.filename, path: req.file.path });
});

app.post('/send-report', async (req, res) => {
  const { unit, tenant, inspector, inspectorEmail, officeEmail, damages } = req.body;

  let html = `<h2>Inspection Report</h2>
    <p><b>Unit:</b> ${unit}</p>
    <p><b>Tenant:</b> ${tenant}</p>
    <p><b>Inspector:</b> ${inspector}</p>
    <p><b>Date:</b> ${new Date().toLocaleDateString()}</p>
    <h3>Damages</h3>
    <table border="1" cellpadding="6" cellspacing="0">
    <tr><th>Room</th><th>Damage</th><th>Charge</th><th>Notes</th><th>Photo</th></tr>`;

  let total = 0;
  const attachments = [];

  for (const d of damages) {
    let driveLink = '';
    if (d.filename) {
      const filePath = path.join(uploadPath, d.filename);
      if (fs.existsSync(filePath)) {
        const fileData = fs.readFileSync(filePath);
        attachments.push({
          content: fileData.toString('base64'),
          filename: d.filename,
          type: 'image/jpeg',
          disposition: 'attachment'
        });
        const link = await uploadToDrive(filePath, d.filename, unit);
        if (link) driveLink = `<a href="${link}">View Photo</a>`;
      }
    }
    html += `<tr><td>${d.room}</td><td>${d.damage}</td><td>$${d.price}</td><td>${d.notes || ''}</td><td>${driveLink}</td></tr>`;
    total += parseFloat(d.price) || 0;
  }

  html += `<tr><td colspan="3"><b>Total</b></td><td><b>$${total.toFixed(2)}</b></td><td></td></tr></table>`;

  try {
    await sgMail.send({
      from: process.env.EMAIL_FROM,
      to: officeEmail,
      subject: `Inspection Report — Unit ${unit}`,
      html,
      attachments
    });

    await sgMail.send({
      from: process.env.EMAIL_FROM,
      to: inspectorEmail,
      subject: `✅ Confirmation — Report sent for Unit ${unit}`,
      html: `<h2>Report Confirmation</h2>
        <p>Hi ${inspector},</p>
        <p>Your inspection report for <b>Unit ${unit}</b> has been successfully submitted.</p>
        <p><b>Tenant:</b> ${tenant}</p>
        <p><b>Date:</b> ${new Date().toLocaleDateString()}</p>
        <p><b>Damages logged:</b> ${damages.length}</p>
        <p><b>Total charges:</b> $${total.toFixed(2)}</p>
        <p>The full report and photos have been sent to the office and uploaded to Google Drive.</p>`
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err.response ? err.response.body : err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3001, () => {
  console.log(`✅ Inspection server running on http://localhost:${process.env.PORT || 3001}`);
  console.log(`