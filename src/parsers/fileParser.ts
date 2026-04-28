import { readFile as readLocalFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import path from "node:path";
import * as xlsx from "xlsx";
import mammoth from "mammoth";
import { google } from "googleapis";

export type FileSource = "local" | "url" | "drive";
export type ParsedFile = string | Record<string, unknown>;

export async function readFile(source: FileSource, pathOrId: string): Promise<ParsedFile> {
  return parseFile(source, pathOrId);
}

async function parseByExtension(extension: string, buffer: Buffer): Promise<ParsedFile> {
  if (extension === ".pdf") {
    return await parsePdf(buffer);
  }

  if (extension === ".xls" || extension === ".xlsx") {
    return parseSpreadsheet(buffer);
  }

  if (extension === ".docx") {
    return await parseDocx(buffer);
  }

  if (extension === ".txt") {
    return buffer.toString("utf-8");
  }

  throw new Error(`Unsupported document type: ${extension}`);
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const pdfParse: (input: Buffer) => Promise<{ text?: string }> = require("pdf-parse");
  const parsed = await pdfParse(buffer);
  return parsed.text ?? "";
}

function parseSpreadsheet(buffer: Buffer): Record<string, unknown> {
  const workbook = xlsx.read(buffer, { type: "buffer" });
  const output: Record<string, unknown> = {};
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    output[sheetName] = xlsx.utils.sheet_to_json(sheet, { defval: null });
  }
  return output;
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

async function downloadFromUrl(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`URL fetch failed: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function downloadFromDrive(fileId: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth credentials are not configured");
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  const drive = google.drive({ version: "v3", auth: oauth2Client });
  const metadata = await drive.files.get({ fileId, fields: "name" });
  const fileName = metadata.data.name ?? fileId;

  const contentResponse = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );

  const tempUrl = `https://local-buffer/${fileName}`;
  const body = Buffer.from(contentResponse.data as ArrayBuffer);
  driveBufferCache.set(tempUrl, body);
  return tempUrl;
}

const driveBufferCache = new Map<string, Buffer>();

async function downloadFromUrlOrCache(url: string): Promise<Buffer> {
  const cached = driveBufferCache.get(url);
  if (cached) {
    return cached;
  }
  return downloadFromUrl(url);
}

// Keep exported signature exactly requested and route all binary fetching centrally.
export async function parseFile(source: FileSource, pathOrId: string): Promise<ParsedFile> {
  const fileRef = source === "drive" ? await downloadFromDrive(pathOrId) : pathOrId;
  const extension = path.extname(fileRef).toLowerCase();
  const buffer = source === "local" ? await readLocalFile(pathOrId) : await downloadFromUrlOrCache(fileRef);
  return await parseByExtension(extension, buffer);
}
