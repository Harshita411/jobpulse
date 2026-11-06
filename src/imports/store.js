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
        const jobs = db.collection('jobs');
        await records.createIndex({ importId: 1, rowNumber: 1 }, { unique: true });
        await jobs.createIndex({ ownerId: 1, createdAt: -1 });
        await imports.createIndex({ ownerId: 1, createdAt: -1 });
        await records.createIndex({ ownerId: 1, importId: 1 });
        return { imports, records, jobs };
      })().catch(error => { initialization = undefined; throw error; });
    }
    return initialization;
  }
  return {
    async rememberJob(jobId, ownerId, type) {
      if (!ownerId) throw new Error('Owned jobs require an owner');
      const { jobs } = await collections();
      try {
        await jobs.updateOne({ _id: jobId, ownerId }, { $setOnInsert: { ownerId, type, createdAt: new Date() } }, { upsert: true });
      } catch (error) {
        if (error.code !== 11000 || !await jobs.findOne({ _id: jobId, ownerId })) throw error;
      }
    },
    async ownsJob(jobId, ownerId) { return Boolean(await (await collections()).jobs.findOne({ _id: jobId, ownerId })); },
    async ownedJobs(ownerId) { return (await collections()).jobs.find({ ownerId }, { projection: { _id: 1 } }).sort({ createdAt: -1 }).toArray(); },
    async putSource(importId, source, ownerId) {
      const { imports } = await collections();
      try {
        await imports.updateOne({ _id: importId, ...ownerFilter(ownerId) }, { $setOnInsert: {
          ...(ownerId ? { ownerId } : {}),
          source, schemaVersion: SCHEMA_VERSION, createdAt: new Date(),
          processed: 0, accepted: 0, rejected: 0, finished: false,
        } }, { upsert: true });
      } catch (error) {
        // Concurrent identical submissions can race on the unique _id index.
        if (error.code !== 11000 || !await imports.findOne({ _id: importId, ...ownerFilter(ownerId) })) throw error;
      }
    },
    async getSource(importId, ownerId) {
      const { imports } = await collections();
      return (await imports.findOne({ _id: importId, ...ownerFilter(ownerId) }, { projection: { source: 1 } }))?.source;
    },
    async writeBatch(importId, rows, ownerId) {
      if (!rows.length) return;
      const { records } = await collections();
      const operations = rows.map(({ rowNumber, record }) => ({ updateOne: {
        filter: { importId, rowNumber, ...ownerFilter(ownerId) },
        update: { $setOnInsert: { importId, rowNumber, ...(ownerId ? { ownerId } : {}), ...record } }, upsert: true,
      } }));
      try { await records.bulkWrite(operations, { ordered: false }); }
      catch (error) {
        // Only suppress actual unique-key races; never swallow network/write concern errors.
        if (!error.writeErrors?.length || error.writeErrors.some(item => item.code !== 11000)
          || error.writeConcernErrors?.length || error.result?.getWriteConcernError?.()) throw error;
      }
    },
    async checkpoint(importId, counts, finished = false, ownerId) {
      const { imports } = await collections();
      await imports.updateOne({ _id: importId, ...ownerFilter(ownerId) }, {
        $max: { processed: counts.processed, accepted: counts.accepted, rejected: counts.rejected },
        ...(finished ? { $set: { finished: true } } : {}),
      });
    },
    async summary(importId, ownerId) {
      const { imports } = await collections();
      return imports.findOne({ _id: importId, ...ownerFilter(ownerId) }, { projection: { source: 0, ownerId: 0 } });
    },
    async close() { await client.close(); },
  };
}

function ownerFilter(ownerId) { return { ownerId: ownerId || { $exists: false } }; }
