const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
    <h3>Damages</h3><table border="1" cellpadding="6" cellspacing="0">
    <tr><th>Room</th><th>Damage</th><th>Charge</th><th>Notes</th></tr>`;

  let total = 0;
  const attachments = [];

  for (const d of damages) {
    html += `<tr><td>${d.room}</td><td>${d.damage}</td><td>$${d.price}</td><td>${d.notes || ''}</td></tr>`;
    total += parseFloat(d.price) || 0;
    if (d.filename) {
      const filePath = path.join(uploadPath, d.filename);
      if (fs.existsSync(filePath)) {
        attachments.push({ filename: d.filename, path: filePath });
      }
    }
  }

  html += `<tr><td colspan="2"><b>Total</b></td><td><b>$${total.toFixed(2)}</b></td><td></td></tr></table>`;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
  });

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: officeEmail,
      subject: `Inspection Report — Unit ${unit}`,
      html,
      attachments
    });

    await transporter.sendMail({
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
        <p>The full report and photos have been sent to the office.</p>`
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3001, () => {
  console.log(`✅ Inspection server running on http://localhost:${process.env.PORT || 3001}`);
  console.log(`   Upload folder: ${uploadPath}`);
  console.log(`   Email account: ${process.env.EMAIL_USER}`);
});