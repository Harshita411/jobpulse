import { MongoClient } from 'mongodb';

export function createAuthStore(mongodbUrl) {
  const client = new MongoClient(mongodbUrl, { serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000, socketTimeoutMS: 10000 });
  let ready;
  async function collections() {
    if (!ready) ready = (async () => {
      await client.connect();
      const users = client.db().collection('users');
      const sessions = client.db().collection('sessions');
      await users.createIndex({ email: 1 }, { unique: true });
      await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await sessions.createIndex({ userId: 1 });
      return { users, sessions };
    })().catch(error => { ready = undefined; throw error; });
    return ready;
  }
  return {
    async createUser(user) { const { users } = await collections(); await users.insertOne(user); },
    async userByEmail(email) { return (await collections()).users.findOne({ email }); },
    async userById(id) { return (await collections()).users.findOne({ _id: id }); },
    async createSession(session) { await (await collections()).sessions.insertOne(session); },
    async sessionByHash(hash) {
      // Expiration is enforced here even if MongoDB's asynchronous TTL cleanup has not run.
      return (await collections()).sessions.findOne({ _id: hash, expiresAt: { $gt: new Date() } });
    },
    async deleteSession(hash) { await (await collections()).sessions.deleteOne({ _id: hash }); },
    async close() { await client.close(); },
  };
}
