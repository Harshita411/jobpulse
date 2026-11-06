import { MongoClient } from 'mongodb';
import { SCHEMA_VERSION } from './csv.js';

// Lazy initialization keeps simulation-only API/worker operation independent of MongoDB.
export function createImportStore(mongodbUrl) {
  const client = new MongoClient(mongodbUrl, {
    serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000,
    socketTimeoutMS: 10000, maxPoolSize: 5, promoteBuffers: true,
  });
  let initialization;
  async function collections() {
    if (!initialization) {
      initialization = (async () => {
        await client.connect();
        const db = client.db();
        const imports = db.collection('imports');
        const records = db.collection('records');
        await records.createIndex({ importId: 1, rowNumber: 1 }, { unique: true });
        return { imports, records };
      })().catch(error => { initialization = undefined; throw error; });
    }
    return initialization;
  }
  return {
    async putSource(importId, source) {
      const { imports } = await collections();
      try {
        await imports.updateOne({ _id: importId }, { $setOnInsert: {
          source, schemaVersion: SCHEMA_VERSION, createdAt: new Date(),
          processed: 0, accepted: 0, rejected: 0, finished: false,
        } }, { upsert: true });
      } catch (error) {
        // Concurrent identical submissions can race on the unique _id index.
        if (error.code !== 11000) throw error;
      }
    },
    async getSource(importId) {
      const { imports } = await collections();
      return (await imports.findOne({ _id: importId }, { projection: { source: 1 } }))?.source;
    },
    async writeBatch(importId, rows) {
      if (!rows.length) return;
      const { records } = await collections();
      const operations = rows.map(({ rowNumber, record }) => ({ updateOne: {
        filter: { importId, rowNumber },
        update: { $setOnInsert: { importId, rowNumber, ...record } }, upsert: true,
      } }));
      try { await records.bulkWrite(operations, { ordered: false }); }
      catch (error) {
        // Only suppress actual unique-key races; never swallow network/write concern errors.
        if (!error.writeErrors?.length || error.writeErrors.some(item => item.code !== 11000)
          || error.writeConcernErrors?.length || error.result?.getWriteConcernError?.()) throw error;
      }
    },
    async checkpoint(importId, counts, finished = false) {
      const { imports } = await collections();
      await imports.updateOne({ _id: importId }, {
        $max: { processed: counts.processed, accepted: counts.accepted, rejected: counts.rejected },
        ...(finished ? { $set: { finished: true } } : {}),
      });
    },
    async summary(importId) {
      const { imports } = await collections();
      return imports.findOne({ _id: importId }, { projection: { source: 0 } });
    },
    async close() { await client.close(); },
  };
}
