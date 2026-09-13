import { MongoClient, ObjectId } from "mongodb";
import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  fixturePosterBytes,
  fixtureSource,
  fixtureTopic,
  generationProviderFixtures,
} from "../fixtures/providers";

const appOrigin = process.env.TASK044_APP_URL ?? "http://127.0.0.1:3104";
const stageNames = ["research", "verify", "write", "edit", "illustrate", "publish"] as const;
type SourceReference = { sourceId: string; title: string; url: string };
type ArticleBlock = { text: string; findingIds: string[]; sourceIds: string[] };
type ArticleRecord = { title: string; body: ArticleBlock[]; citedSources: SourceReference[] };
type EvidenceRecord = { findings: Array<{ findingId: string; sourceId: string; verdict: string }>; sources: SourceReference[] };
type PublicPost = { postId: string; topic: string; status: string; article: ArticleRecord; evidence: EvidenceRecord };
type PersistedPost = { postId: string; status: string; dispatchState: string; runId: string; eventId: string; stages: Record<typeof stageNames[number], { status: string; attempts: number; startedAt?: string; endedAt?: string }>; outputs: { article: ArticleRecord; evidence: EvidenceRecord; poster: { posterId: string } } };
type PosterManifest = { _id: string; postId: string; posterId: ObjectId };

function testDatabaseConfig(): { uri: string; dbName: string } {
  const uri = process.env.TEST_MONGODB_URI?.trim();
  const dbName = process.env.TEST_MONGODB_DB?.trim();
  const appUri = process.env.MONGODB_URI?.trim();
  const appDbName = process.env.MONGODB_DB?.trim();
  const isAtlasUri = typeof uri === "string" && /^mongodb(?:\+srv)?:\/\/[^/]*\.mongodb\.net(?:\/|$)/i.test(uri);
  if (!uri || !dbName || !appUri || !appDbName || uri !== appUri || dbName !== appDbName || !isAtlasUri || !/^postforge_test_[a-z0-9_]+$/.test(dbName) || dbName.length > 63) {
    throw new Error("TASK-044 requires matching MONGODB_URI/TEST_MONGODB_URI for Atlas and an isolated postforge_test_* MONGODB_DB.");
  }
  return { uri, dbName };
}

async function waitForDone(request: APIRequestContext, postId: string): Promise<void> {
  await expect.poll(async () => {
    const response = await request.get(`${appOrigin}/api/posts/${postId}`);
    if (!response.ok()) return `http-${response.status()}`;
    const payload = await response.json() as { post?: { status?: string } };
    return payload.post?.status ?? "missing";
  }, { timeout: 180_000, intervals: [250, 500, 1_000, 2_000] }).toBe("done");
}

test.describe("complete generation flow", () => {
  test("submits through the real API, completes the durable workflow, and reopens the persisted post", async ({ page, request }) => {
    test.setTimeout(240_000);
    const { uri, dbName } = testDatabaseConfig();
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
    await client.connect();

    try {
      const db = client.db(dbName);
      const posts = db.collection("posts");
      const postCountBefore = await posts.countDocuments();

      await page.goto(`${appOrigin}/`);
      await page.getByLabel("What should we explore?").fill(fixtureTopic);
      const generateResponsePromise = page.waitForResponse((response) =>
        response.url() === `${appOrigin}/api/generate` && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Generate post" }).click();

      const generateResponse = await generateResponsePromise;
      expect(generateResponse.status()).toBe(202);
      const submitted = generateResponse.request().postDataJSON() as { topic?: string; submissionKey?: string };
      expect(submitted.topic).toBe(fixtureTopic);
      expect(submitted.submissionKey).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
      const accepted = await generateResponse.json() as { postId?: string };
      expect(accepted.postId).toMatch(/^[a-f0-9]{24}$/);
      const postId = accepted.postId!;

      await expect(page).toHaveURL(new RegExp(`/posts/${postId}$`));
      await waitForDone(request, postId);

      const postResponse = await request.get(`${appOrigin}/api/posts/${postId}`);
      expect(postResponse.status()).toBe(200);
      const publicPost = (await postResponse.json() as { post: PublicPost }).post;
      expect(publicPost).toMatchObject({ postId, topic: fixtureTopic, status: "done" });
      expect(publicPost.evidence.findings[0]).not.toHaveProperty("evidence");

      const persistedPosts = await posts.find({}).toArray();
      expect(persistedPosts).toHaveLength(postCountBefore + 1);
      const persisted = persistedPosts.find((candidate) => candidate.postId === postId) as PersistedPost | undefined;
      expect(persisted).toBeDefined();
      expect(persisted!.status).toBe("done");
      expect(persisted!.dispatchState).toBe("started");
      expect(persisted!.runId).toBe(persisted!.eventId);
      for (const stage of stageNames) {
        expect(persisted!.stages[stage].status).toBe("done");
        expect(persisted!.stages[stage].attempts).toBeGreaterThanOrEqual(1);
        expect(persisted!.stages[stage].startedAt).toBeTruthy();
        expect(persisted!.stages[stage].endedAt).toBeTruthy();
      }

      const article = persisted!.outputs.article;
      const evidence = persisted!.outputs.evidence;
      const finding = evidence.findings.find((item) => item.findingId === "finding_1");
      const citation = article.citedSources.find((item) => item.sourceId === fixtureSource.sourceId);
      expect(finding).toMatchObject({ sourceId: fixtureSource.sourceId, verdict: "supported" });
      expect(citation).toEqual({ sourceId: fixtureSource.sourceId, title: fixtureSource.title, url: fixtureSource.url });
      expect(article.body[0].findingIds).toContain(finding!.findingId);
      expect(article.body[0].sourceIds).toContain(citation!.sourceId);
      expect(publicPost.article.citedSources).toEqual([citation]);
      expect(publicPost.evidence.sources).toEqual([{ sourceId: fixtureSource.sourceId, title: fixtureSource.title, url: fixtureSource.url }]);

      const posterId = persisted!.outputs.poster.posterId as string;
      expect(posterId).toMatch(/^[a-f0-9]{24}$/);
      const posterResponse = await request.get(`${appOrigin}/api/posters/${posterId}`);
      expect(posterResponse.status()).toBe(200);
      expect(posterResponse.headers()["content-type"]).toContain(generationProviderFixtures.image.mediaType);
      expect(Buffer.from(await posterResponse.body())).toEqual(fixturePosterBytes);

      const manifest = await db.collection<PosterManifest>("poster_uploads").findOne({ _id: `${postId}:illustrate`, status: "complete" });
      expect(manifest).toBeTruthy();
      expect(manifest!.postId).toBe(postId);
      expect(manifest!.posterId.toHexString()).toBe(posterId);
      expect(await db.collection("posters.files").countDocuments({ _id: manifest!.posterId })).toBe(1);
      expect(await db.collection("posters.chunks").countDocuments({ files_id: manifest!.posterId })).toBeGreaterThan(0);
      expect((await db.collection("posters.files").findOne({ _id: manifest!.posterId }))!.length).toBe(fixturePosterBytes.length);

      await page.goto(`${appOrigin}/posts/${postId}`);
      await expect(page.getByTestId("run-completion-slot")).toBeVisible();
      await expect(page.getByRole("heading", { name: article.title, exact: true })).toBeVisible();
      await expect(page.getByText(article.body[0].text, { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: fixtureSource.title, exact: true })).toBeVisible();
      await expect(page.getByRole("img", { name: `Generated poster accompanying “${article.title}”` })).toBeVisible();
      await page.getByText("View completed generation stages", { exact: true }).click();
      await expect(page.locator(".stage-item.stage-done")).toHaveCount(6);

      await page.goto(`${appOrigin}/library`);
      const openPost = page.getByRole("link", { name: `Open post: ${fixtureTopic}` });
      await expect(openPost).toHaveAttribute("href", `/posts/${postId}`);
      await openPost.click();
      await expect(page).toHaveURL(new RegExp(`/posts/${postId}$`));
      await expect(page.getByRole("heading", { name: article.title, exact: true })).toBeVisible();
    } finally {
      await client.close();
    }
  });
});
