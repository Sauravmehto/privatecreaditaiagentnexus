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
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDB = connectDB;
exports.getDB = getDB;
exports.findDeals = findDeals;
exports.findDealById = findDealById;
exports.aggregateDeals = aggregateDeals;
exports.insertAuditLog = insertAuditLog;
exports.testConnection = testConnection;
exports.__setMongoExecutorsForTests = __setMongoExecutorsForTests;
exports.closeConnection = closeConnection;
const dns = __importStar(require("dns"));
const mongodb_1 = require("mongodb");
// Node.js c-ares on Windows refuses SRV queries to local routers.
// Using Google's public DNS resolver fixes mongodb+srv:// connections.
dns.setServers(["8.8.8.8", "8.8.4.4"]);
let client = null;
let dbName = "private_credit";
function getMongoUri() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error("MONGODB_URI is not configured");
    }
    return uri;
}
function resolveDbName(uri) {
    try {
        const parsed = new URL(uri);
        const fromPath = parsed.pathname.replace("/", "").trim();
        return fromPath || "private_credit";
    }
    catch {
        return "private_credit";
    }
}
async function connectDB() {
    if (client) {
        return client;
    }
    const uri = getMongoUri();
    dbName = resolveDbName(uri);
    client = new mongodb_1.MongoClient(uri);
    await client.connect();
    return client;
}
async function getDB() {
    const activeClient = await connectDB();
    return activeClient.db(dbName);
}
let findDealsExecutor = async (filter = {}) => {
    const db = await getDB();
    return db.collection("deals").find(filter).toArray();
};
let findDealExecutor = async (filter) => {
    const db = await getDB();
    return db.collection("deals").findOne(filter);
};
let aggregateDealsExecutor = async (pipeline) => {
    const db = await getDB();
    return db.collection("deals").aggregate(pipeline).toArray();
};
let insertAuditExecutor = async (entry) => {
    const db = await getDB();
    await db.collection("audit_logs").insertOne(entry);
};
async function findDeals(filter = {}) {
    return findDealsExecutor(filter);
}
async function findDealById(id) {
    return findDealExecutor({ id });
}
async function aggregateDeals(pipeline) {
    return aggregateDealsExecutor(pipeline);
}
async function insertAuditLog(entry) {
    await insertAuditExecutor(entry);
}
async function testConnection() {
    const db = await getDB();
    await db.command({ ping: 1 });
}
function __setMongoExecutorsForTests(executors) {
    if (executors.findDeals) {
        findDealsExecutor = executors.findDeals;
    }
    if (executors.findDeal) {
        findDealExecutor = executors.findDeal;
    }
    if (executors.aggregateDeals) {
        aggregateDealsExecutor = executors.aggregateDeals;
    }
    if (executors.insertAudit) {
        insertAuditExecutor = executors.insertAudit;
    }
}
async function closeConnection() {
    if (client) {
        await client.close();
        client = null;
    }
}
