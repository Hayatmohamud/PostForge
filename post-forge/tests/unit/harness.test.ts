import { describe, expect, test } from "vitest";
import { readTestDatabaseConfig } from "../helpers/setup";

describe("isolated database configuration (no database connection)", () => {
  test("requires explicit test variables even when production variables exist", () => {
    expect(() => readTestDatabaseConfig({
      MONGODB_URI: "mongodb://127.0.0.1:27017",
      MONGODB_DB: "production",
    })).toThrow("Set both TEST_MONGODB_URI and TEST_MONGODB_DB");
  });

  test.each(["127.0.0.1", "localhost", "[::1]"])("accepts explicit local isolation on %s", (host) => {
    expect(readTestDatabaseConfig({
      TEST_MONGODB_URI: `mongodb://${host}:27019`,
      TEST_MONGODB_DB: "postforge_test_task003_run1",
    })).toEqual({
      uri: `mongodb://${host}:27019`,
      dbName: "postforge_test_task003_run1",
    });
  });

  test.each([
    "mongodb://production.example:27017",
    "mongodb+srv://cluster.example",
    "mongodb://127.0.0.1:27017/production",
    "mongodb://user:password@127.0.0.1:27017",
    "mongodb://127.0.0.1:27017/?authSource=production",
    "mongodb://127.0.0.1:27017,production.example:27017",
    "mongodb://127.0.0.1:0",
    "mongodb://127.0.0.1:65536",
  ])("rejects unsafe or ambiguous URI %s", (uri) => {
    expect(() => readTestDatabaseConfig({
      TEST_MONGODB_URI: uri,
      TEST_MONGODB_DB: "postforge_test_task003_run1",
    })).toThrow("loopback host and explicit port");
  });

  test.each(["production", "admin", "postforge_test_", "postforge_test_a/b"])("rejects non-test database %s", (dbName) => {
    expect(() => readTestDatabaseConfig({
      TEST_MONGODB_URI: "mongodb://127.0.0.1:27017",
      TEST_MONGODB_DB: dbName,
    })).toThrow("dedicated postforge_test_*");
  });
});
