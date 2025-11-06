const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

const ATTACH_BASE = process.env.ATTACH_BASE || './data';

async function ensureAttachBase() {
  try {
    await fs.mkdir(ATTACH_BASE, { recursive: true });
  } catch (err) {
    logger.error('Failed to create attachment base directory', { error: err.message });
    throw err;
  }
}

function safeEmailFolder(email) {
  // Create a hash to avoid filesystem issues with special chars
  return crypto.createHash('md5').update(email).digest('hex');
}

async function getSessionAttachmentDir(email, messageUuid) {
  const emailSafe = safeEmailFolder(email);
  const sessionDir = path.join(ATTACH_BASE, emailSafe);
  const messageDir = path.join(sessionDir, messageUuid);
  
  await fs.mkdir(messageDir, { recursive: true });
  return messageDir;
}

function sanitizeFilename(filename) {
  // Remove path traversal attempts and keep only safe chars
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 255);
}

async function saveAttachment(email, messageUuid, filename, contentBuffer) {
  const messageDir = await getSessionAttachmentDir(email, messageUuid);
  const safeName = sanitizeFilename(filename);
  const filePath = path.join(messageDir, safeName);
  
  // Ensure path is within expected directory (guard against traversal)
  const resolvedPath = path.resolve(filePath);
  const resolvedMessageDir = path.resolve(messageDir);
  if (!resolvedPath.startsWith(resolvedMessageDir)) {
    throw new Error('Path traversal attempt detected');
  }
  
  // Write buffer to file
  await fs.writeFile(filePath, contentBuffer);
  
  const relativePath = path.relative(ATTACH_BASE, filePath);
  return { absolutePath: filePath, relativePath };
}

async function deleteSessionAttachments(email) {
  const emailSafe = safeEmailFolder(email);
  const sessionDir = path.join(ATTACH_BASE, emailSafe);
  
  try {
    await fs.rm(sessionDir, { recursive: true, force: true });
    logger.info('Session attachments deleted', { email, dir: sessionDir });
  } catch (err) {
    logger.error('Failed to delete session attachments', { 
      email, 
      dir: sessionDir, 
      error: err.message 
    });
  }
}

function getAttachmentPath(relativePath) {
  const absolutePath = path.join(ATTACH_BASE, relativePath);
  const resolvedPath = path.resolve(absolutePath);
  const resolvedBase = path.resolve(ATTACH_BASE);
  
  if (!resolvedPath.startsWith(resolvedBase)) {
    throw new Error('Invalid attachment path');
  }
  
  return absolutePath;
}

async function attachmentExists(relativePath) {
  try {
    const absolutePath = getAttachmentPath(relativePath);
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  ensureAttachBase,
  safeEmailFolder,
  getSessionAttachmentDir,
  sanitizeFilename,
  saveAttachment,
  deleteSessionAttachments,
  getAttachmentPath,
  attachmentExists
};

