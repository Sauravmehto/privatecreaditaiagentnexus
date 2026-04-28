"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readFile = readFile;
exports.downloadFromDrive = downloadFromDrive;
exports.parseFile = parseFile;
const promises_1 = require("node:fs/promises");
const node_buffer_1 = require("node:buffer");
const node_path_1 = __importDefault(require("node:path"));
const xlsx = __importStar(require("xlsx"));
const mammoth_1 = __importDefault(require("mammoth"));
const googleapis_1 = require("googleapis");
async function readFile(source, pathOrId) {
    return parseFile(source, pathOrId);
}
async function parseByExtension(extension, buffer) {
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
async function parsePdf(buffer) {
    const pdfParse = require("pdf-parse");
    const parsed = await pdfParse(buffer);
    return parsed.text ?? "";
}
function parseSpreadsheet(buffer) {
    const workbook = xlsx.read(buffer, { type: "buffer" });
    const output = {};
    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        output[sheetName] = xlsx.utils.sheet_to_json(sheet, { defval: null });
    }
    return output;
}
async function parseDocx(buffer) {
    const result = await mammoth_1.default.extractRawText({ buffer });
    return result.value ?? "";
}
async function downloadFromUrl(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`URL fetch failed: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return node_buffer_1.Buffer.from(arrayBuffer);
}
async function downloadFromDrive(fileId) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !redirectUri) {
        throw new Error("Google OAuth credentials are not configured");
    }
    const oauth2Client = new googleapis_1.google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken
    });
    const drive = googleapis_1.google.drive({ version: "v3", auth: oauth2Client });
    const metadata = await drive.files.get({ fileId, fields: "name" });
    const fileName = metadata.data.name ?? fileId;
    const contentResponse = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    const tempUrl = `https://local-buffer/${fileName}`;
    const body = node_buffer_1.Buffer.from(contentResponse.data);
    driveBufferCache.set(tempUrl, body);
    return tempUrl;
}
const driveBufferCache = new Map();
async function downloadFromUrlOrCache(url) {
    const cached = driveBufferCache.get(url);
    if (cached) {
        return cached;
    }
    return downloadFromUrl(url);
}
// Keep exported signature exactly requested and route all binary fetching centrally.
async function parseFile(source, pathOrId) {
    const fileRef = source === "drive" ? await downloadFromDrive(pathOrId) : pathOrId;
    const extension = node_path_1.default.extname(fileRef).toLowerCase();
    const buffer = source === "local" ? await (0, promises_1.readFile)(pathOrId) : await downloadFromUrlOrCache(fileRef);
    return await parseByExtension(extension, buffer);
}
