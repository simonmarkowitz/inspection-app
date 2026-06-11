const express = require('express');
const multer = require('multer');
const sgMail = require('@sendgrid/mail');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
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
const oauth2Client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.REDIRECT_URI);
if (process.env.GOOGLE_REFRESH_TOKEN) { oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN }); }
app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/spreadsheets'], prompt: 'consent' });
  res.redirect(url);
});
app.get('/auth/callback', async (req, res) => {
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    oauth2Client.setCredentials(tokens);
    res.send('<h2>Authorization successful!</h2><p>Refresh token: <b>' + tokens.refresh_token + '</b></p><p>Copy this token and add it to Render as GOOGLE_REFRESH_TOKEN, then you can close this page.</p>');
  } catch (err) { res.send('Error: ' + err.message); }
});
async function uploadToDrive(filePath, filename, unit) {
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const folderRes = await drive.files.list({ q: "name='Unit " + unit + "' and mimeType='application/vnd.google-apps.folder' and '" + process.env.DRIVE_FOLDER_ID + "' in parents and trashed=false", fields: 'files(id, name)' });
    let unitFolderId;
    if (folderRes.data.files.len