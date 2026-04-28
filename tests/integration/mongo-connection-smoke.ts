/// <reference types="node" />
import "dotenv/config";
import * as dns from "dns";
import { MongoClient } from "mongodb";

// Node.js c-ares on Windows sometimes refuses SRV DNS queries to the local
// router. Switching to Google's public resolver fixes this.
dns.setServers(["8.8.8.8", "8.8.4.4"]);

async function run(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db("private_credit");
    const collection = db.collection("connection_smoke");

    const marker = `smoke_${Date.now()}`;
    await collection.insertOne({
      marker,
      source: "mongo-connection-smoke",
      created_at: new Date().toISOString()
    });

    const found = await collection.findOne({ marker });
    if (!found) {
      throw new Error("Smoke read failed: inserted document not found");
    }

    await collection.deleteOne({ marker });
    console.log("MongoDB Atlas smoke test passed (write + read + cleanup).");
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error("MongoDB Atlas smoke test failed:", error);
  process.exit(1);
});
