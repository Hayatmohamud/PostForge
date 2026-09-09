import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readTestDatabaseConfig } from "../helpers/setup";

vi.mock("server-only", () => ({}));
const driver = vi.hoisted(() => ({
  construct: vi.fn(),
  connect: vi.fn<() => Promise<void>>(),
  close: vi.fn<() => Promise<void>>(),
  db: vi.fn(),
  writes: vi.fn(),
  reads: vi.fn(),
  documents: new Map<string, Map<string, unknown>>(),
}));

// Offline contract integration only: no sockets, real MongoDB deployment, or
// credentialed data access. Preserve real driver errors/types; replace its client.
vi.mock("mongodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mongodb")>();
  return {
    ...actual,
    MongoClient: class FixtureClient {
      constructor(uri: string, options: unknown) { driver.construct(uri, options); }
      async connect() { await driver.connect(); return this; }
      async close() { await driver.close(); }
      db(name: string) {
        driver.db(name);
        return {
          databaseName: name,
          collection(collection: string) {
            const key = `${name}/${collection}`;
            let documents = driver.documents.get(key);
            if (!documents) { documents = new Map(); driver.documents.set(key, documents); }
            return {
              async insertOne(document: { _id: string; value: string }) {
                driver.writes(name, collection, document);
                documents.set(document._id, structuredClone(document));
                return { acknowledged: true, insertedId: document._id };
              },
              async findOne(filter: { _id: string }) {
                driver.reads(name, collection, filter);
                return structuredClone(documents.get(filter._id) ?? null);
              },
            };
          },
        };
      }
    },
  };
});

import { MongoNetworkError, MongoOperationTimeoutError } from "mongodb";
import { closeMongoConnections, getMongoDatabase } from "../../src/lib/mongo";

function testEnv(): Record<string, string | undefined> {
  const explicit = {
    TEST_MONGODB_URI: "mongodb://127.0.0.1:27019",
    TEST_MONGODB_DB: "postforge_test_task006_fixture",
  };
  // Reuse the harness's independent isolation gate, with no production fallback.
  const { uri, dbName } = readTestDatabaseConfig(explicit);
  return {
    ...explicit,
    MONGODB_URI: uri, MONGODB_DB: dbName,
    OPENROUTER_API_KEY: "fake-text-key", OPENROUTER_MODEL: "z-ai/glm-5.3-flash",
    SERPER_API_KEY: "fake-search-key", GEMINI_API_KEY: "fake-image-key",
    IMAGE_PROVIDER: "gemini", IMAGE_MODEL: "gemini-2.5-flash-image", INNGEST_DEV: "true",
  };
}

beforeEach(async () => {
  await closeMongoConnections();
  vi.clearAllMocks();
  driver.construct.mockReset();
  driver.connect.mockReset().mockResolvedValue(undefined);
  driver.close.mockReset().mockResolvedValue(undefined);
  driver.db.mockReset();
  driver.documents.clear();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  driver.close.mockResolvedValue(undefined);
  await closeMongoConnections();
  vi.unstubAllEnvs();
});

describe("MongoDB helper with an isolated client fixture", () => {
  test("module reloads do not construct or connect eagerly", async () => {
    vi.resetModules();
    await import("../../src/lib/mongo");
    expect(driver.construct).not.toHaveBeenCalled();
    expect(driver.connect).not.toHaveBeenCalled();
  });

  test("connects, writes, and reads only the explicit fixture database", async () => {
    const db = await getMongoDatabase(testEnv());
    const collection = db.collection<{ _id: string; value: string }>("probe");
    expect(await collection.insertOne({ _id: "fixture-document", value: "isolated" })).toMatchObject({ acknowledged: true });
    expect(await collection.findOne({ _id: "fixture-document" })).toEqual({ _id: "fixture-document", value: "isolated" });
    expect(db.databaseName).toBe("postforge_test_task006_fixture");
    expect(driver.db).toHaveBeenCalledWith("postforge_test_task006_fixture");
    expect(driver.writes).toHaveBeenCalledWith("postforge_test_task006_fixture", "probe", { _id: "fixture-document", value: "isolated" });
    expect(driver.reads).toHaveBeenCalledWith("postforge_test_task006_fixture", "probe", { _id: "fixture-document" });
  });

  test("shares one in-flight connection among concurrent callers", async () => {
    let release!: () => void;
    driver.connect.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = getMongoDatabase(testEnv());
    const second = getMongoDatabase(testEnv());
    await Promise.resolve();
    expect(driver.construct).toHaveBeenCalledTimes(1);
    expect(driver.connect).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    await getMongoDatabase(testEnv());
    expect(driver.construct).toHaveBeenCalledTimes(1);
    expect(driver.close).not.toHaveBeenCalled();
  });

  test("reuses the client after a development-style module reload", async () => {
    await getMongoDatabase(testEnv());
    vi.resetModules();
    const reloaded = await import("../../src/lib/mongo");
    await reloaded.getMongoDatabase(testEnv());
    expect(driver.construct).toHaveBeenCalledTimes(1);
    expect(driver.connect).toHaveBeenCalledTimes(1);
  });

  test("uses explicit database handles when sharing one deployment pool", async () => {
    const first = await getMongoDatabase(testEnv());
    const alternate = "postforge_test_task006_alternate";
    const second = await getMongoDatabase({ ...testEnv(), MONGODB_DB: alternate, TEST_MONGODB_DB: alternate });
    expect(first.databaseName).not.toBe(second.databaseName);
    expect(second.databaseName).toBe(alternate);
    expect(driver.construct).toHaveBeenCalledTimes(1);
    expect(driver.db.mock.calls.map(([name]) => name)).toEqual(["postforge_test_task006_fixture", alternate]);
  });

  test("uses centralized timeout policy and disables raw driver logging", async () => {
    vi.stubEnv("MONGODB_LOG_COMMAND", "debug");
    vi.stubEnv("MONGODB_LOG_CONNECTION", "debug");
    await getMongoDatabase({ ...testEnv(), DATABASE_TIMEOUT_MS: "2500" });
    expect(driver.construct).toHaveBeenCalledWith("mongodb://127.0.0.1:27019", {
      connectTimeoutMS: 2500, serverSelectionTimeoutMS: 2500, waitQueueTimeoutMS: 2500,
      timeoutMS: 2500, mongodbLogComponentSeverities: {
        default: "off", command: "off", topology: "off",
        serverSelection: "off", connection: "off", client: "off",
      },
    });
    await getMongoDatabase({ ...testEnv(), DATABASE_TIMEOUT_MS: "3000" });
    expect(driver.construct).toHaveBeenCalledTimes(2);
  });

  test("different deployment settings cannot reuse a stale client", async () => {
    await getMongoDatabase(testEnv());
    const uri = "mongodb://127.0.0.1:27020";
    await getMongoDatabase({ ...testEnv(), TEST_MONGODB_URI: uri, MONGODB_URI: uri });
    expect(driver.construct).toHaveBeenCalledTimes(2);
  });

  test.each(["MONGODB_URI", "MONGODB_DB", "TEST_MONGODB_URI", "TEST_MONGODB_DB"])("rejects missing and blank %s before constructing a client", async (field) => {
    for (const value of [undefined, "", " \t"]) {
      await expect(getMongoDatabase({ ...testEnv(), [field]: value })).rejects.toMatchObject({ name: "ConfigurationError" });
    }
    expect(driver.construct).not.toHaveBeenCalled();
  });

  test("test worker cannot fall back to an application database, even with an injected production mode", async () => {
    await expect(getMongoDatabase({ ...testEnv(), NODE_ENV: "production", POSTFORGE_TEST_MODE: undefined, MONGODB_DB: "production" })).rejects.toMatchObject({ name: "ConfigurationError" });
    await expect(getMongoDatabase({ ...testEnv(), MONGODB_URI: "mongodb://production.invalid:27017" })).rejects.toMatchObject({ name: "ConfigurationError" });
    expect(driver.construct).not.toHaveBeenCalled();
  });

  test.each([
    "mongodb://production.invalid:27019", "mongodb+srv://cluster.invalid", "mongodb://fake-user:fake-password@127.0.0.1:27019",
    "mongodb://127.0.0.1:27019/production", "mongodb://127.0.0.1:27019/?authSource=production",
    "mongodb://127.0.0.1:0", "mongodb://127.0.0.1:65536",
  ])("rejects unsafe test URI %s", async (uri) => {
    await expect(getMongoDatabase({ ...testEnv(), TEST_MONGODB_URI: uri, MONGODB_URI: uri })).rejects.toMatchObject({ name: "ConfigurationError" });
    expect(driver.construct).not.toHaveBeenCalled();
  });

  test.each(["production", "admin", "postforge_test_", "postforge_test_a/b", `postforge_test_${"a".repeat(64)}`])("rejects unsafe test database %s", async (db) => {
    await expect(getMongoDatabase({ ...testEnv(), TEST_MONGODB_DB: db, MONGODB_DB: db })).rejects.toMatchObject({ name: "ConfigurationError" });
    expect(driver.construct).not.toHaveBeenCalled();
  });

  test("invalid timeout or newly blank config cannot be hidden by the connection cache", async () => {
    await getMongoDatabase(testEnv());
    await expect(getMongoDatabase({ ...testEnv(), DATABASE_TIMEOUT_MS: "0" })).rejects.toMatchObject({ name: "ConfigurationError" });
    await expect(getMongoDatabase({ ...testEnv(), MONGODB_DB: " " })).rejects.toMatchObject({ name: "ConfigurationError" });
    expect(driver.connect).toHaveBeenCalledTimes(1);
  });

  test("reads default process environment lazily with explicit test isolation", async () => {
    for (const [name, value] of Object.entries(testEnv())) vi.stubEnv(name, value);
    vi.stubEnv("DATABASE_TIMEOUT_MS", "1000");
    expect((await getMongoDatabase()).databaseName).toBe("postforge_test_task006_fixture");
    vi.stubEnv("MONGODB_DB", "");
    await expect(getMongoDatabase()).rejects.toMatchObject({ name: "ConfigurationError" });
  });

  test("constructor/URI parse failures are sanitized configuration failures", async () => {
    driver.construct.mockImplementationOnce(() => { throw new Error("mongodb://fake-user:fake-password@private.invalid"); });
    await expect(getMongoDatabase(testEnv())).rejects.toMatchObject({ name: "AppError", code: "CONFIGURATION_ERROR" });
    expect(driver.connect).not.toHaveBeenCalled();
    expect((await getMongoDatabase(testEnv())).databaseName).toBe("postforge_test_task006_fixture");
  });

  test.each([
    [new MongoNetworkError("fake-password private host"), "TRANSIENT_FAILURE"],
    [new MongoOperationTimeoutError("fake-password timeout"), "TRANSIENT_FAILURE"],
    [Object.assign(new Error("fake-password auth"), { code: 18 }), "CONFIGURATION_ERROR"],
    [Object.assign(new Error("fake-password unauthorized"), { code: 13 }), "CONFIGURATION_ERROR"],
    [new Error("fake-password unexpected"), "TERMINAL_FAILURE"],
  ] as const)("cleans up and sanitizes driver failure %s", async (driverError, expectedCode) => {
    driver.connect.mockRejectedValueOnce(driverError);
    driver.close.mockRejectedValueOnce(new Error("fake-password cleanup"));
    const error = await getMongoDatabase(testEnv()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "AppError", code: expectedCode });
    expect(error).not.toHaveProperty("cause");
    expect(String(error)).not.toContain("fake-password");
    expect(JSON.stringify(error)).not.toContain("fake-password");
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("fake-password");
    expect(driver.close).toHaveBeenCalledTimes(1);
    await getMongoDatabase(testEnv());
    expect(driver.construct).toHaveBeenCalledTimes(2);
    expect(driver.connect).toHaveBeenCalledTimes(2);
  });

  test("explicit shutdown closes cached pools and permits a fresh connection", async () => {
    await getMongoDatabase(testEnv());
    await closeMongoConnections();
    expect(driver.close).toHaveBeenCalledTimes(1);
    await getMongoDatabase(testEnv());
    expect(driver.construct).toHaveBeenCalledTimes(2);
  });

  test("shutdown exceptions are sanitized and do not retain stale cache entries", async () => {
    await getMongoDatabase(testEnv());
    driver.close.mockRejectedValueOnce(new Error("fake-password shutdown"));
    await expect(closeMongoConnections()).rejects.toMatchObject({ name: "AppError", code: "TERMINAL_FAILURE" });
    await getMongoDatabase(testEnv());
    expect(driver.construct).toHaveBeenCalledTimes(2);
  });
});
