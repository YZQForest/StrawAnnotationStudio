// Tests only synthetic images. Exercises the shipped offline entry, not a mock UI.
const fs = require("fs"),
  path = require("path"),
  os = require("os");
const assert = require("assert/strict");
const { pathToFileURL } = require("url");
const { spawnSync } = require("child_process");
const { chromium } = require("playwright");
const { PNG } = require("pngjs");
const root = path.resolve(__dirname, "..");
const output =
  process.env.ANNOTATION_TEST_OUTPUT ||
  fs.mkdtempSync(path.join(os.tmpdir(), "straw-v3-"));
fs.mkdirSync(output, { recursive: true });
const width = 128,
  height = 96,
  checks = [];
for (let n = 1; n <= 3; n++) {
  const im = new PNG({ width, height });
  for (let i = 0; i < im.data.length; i += 4) {
    im.data[i] = 90 + n;
    im.data[i + 1] = 130;
    im.data[i + 2] = 100;
    im.data[i + 3] = 255;
  }
  fs.writeFileSync(path.join(output, `synthetic_${n}.png`), PNG.sync.write(im));
}
let browser;
async function run() {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.ANNOTATION_CHROME,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(pathToFileURL(path.join(root, "开始标注.html")).href);
  await page.waitForFunction(() => session && db);
  assert.equal(await page.locator("[data-tool]").count(), 0);
  await page.locator("#annotator").fill("SYNTHETIC_TEST");
  await page.locator("#annotator").press("Tab");
  await page
    .locator("#image-input")
    .setInputFiles(
      [1, 2, 3].map((n) => path.join(output, `synthetic_${n}.png`)),
    );
  await page.waitForFunction(
    () =>
      tasks.length === 3 &&
      current &&
      !switching &&
      document.getElementById("busy").style.display === "none",
  );
  assert.equal(
    await page.evaluate(() => tasks.filter((t) => t.label).length),
    1,
  );
  checks.push("offline file:// entry, import, noncurrent arrays released");
  const originalSession = await page.evaluate(() => session.id);
  await page.locator("#fill-background").click();
  assert.equal(await page.evaluate(() => count(current).unmarked_pixels), 0);
  async function dot(cls, x, y, size = 6) {
    const b = page.locator(`[data-class="${cls}"]`);
    if (!(await b.isVisible())) await page.locator("#more").click();
    await b.click();
    await page.locator("#brush-number").fill(String(size));
    await page.locator("#brush-number").press("Tab");
    const box = await page.locator("#canvas").boundingBox();
    await page.mouse.click(
      box.x + ((x + 0.5) * box.width) / width,
      box.y + ((y + 0.5) * box.height) / height,
    );
  }
  await dot("255", 20, 20);
  const first = await page.evaluate(() => Array.from(current.label));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      assert.equal(
        first[y * width + x],
        (x - 20) ** 2 + (y - 20) ** 2 <= 9 ? 255 : 0,
      );
  await page.locator("#undo").click();
  assert.equal(await page.evaluate(() => count(current).straw_pixels), 0);
  await page.locator("#redo").click();
  assert.deepEqual(await page.evaluate(() => Array.from(current.label)), first);
  await dot("0", 20, 20, 2);
  assert(
    (await page.evaluate(() => count(current).straw_pixels)) <
      first.filter((x) => x === 255).length,
  );
  await dot("128", 40, 40);
  await dot("exclude", 60, 60);
  await dot("restore", 60, 60, 2);
  const expected = await page.evaluate(() => count(current));
  assert.equal(expected.coverage_pp, null);
  assert(expected.uncertain_pixels > 0 && expected.excluded_pixels > 0);
  await page.locator("#fill-background").click();
  assert.deepEqual(await page.evaluate(() => count(current)), expected);
  await page.locator("#review-next").click();
  assert.deepEqual(await page.evaluate(() => count(current)), expected);
  checks.push(
    "original-resolution brush, holes, undo/redo, uncertain versus ROI, non-destructive fill/review",
  );
  // Metadata zero timestamps must survive CSV parsing and export.
  const csv = path.join(output, "metadata.csv");
  fs.writeFileSync(
    csv,
    'output_filename,video_id,frame_id,timestamp_sec,source_video\r\nsynthetic_1.png,v01,0,0,"field, one.mp4"\r\n',
  );
  await page.locator("#source-input").setInputFiles(csv);
  await page.waitForFunction(
    () =>
      current.source.video_id === "v01" &&
      document.getElementById("busy").style.display === "none",
  );
  await page.locator("#check-complete").check();
  await page.locator("#complete").click();
  await page.waitForFunction(
    () => current?.file_name === "synthetic_2.png" && !switching,
  );
  // Reject submitting untouched pixels.
  await page.locator("#check-complete").check();
  await page.locator("#complete").click();
  assert.notEqual(await page.evaluate(() => current.status), "completed");
  await page.locator("#fill-background").click();
  await dot("255", 30, 20);
  await page.locator("#check-complete").check();
  await page.locator("#complete").click();
  await page.waitForFunction(
    () => current?.file_name === "synthetic_3.png" && !switching,
  );
  await dot("255", 30, 20); // Draft intentionally retained with unmarked pixels.
  const draftExpected = await page.evaluate(() => count(current));
  await page.evaluate(() => saveCurrent());
  await page.reload();
  await page.waitForFunction(
    () => current?.file_name === "synthetic_3.png" && !switching,
  );
  assert.deepEqual(await page.evaluate(() => count(current)), draftExpected);
  assert.equal(
    await page.evaluate(() => tasks.filter((t) => t.label).length),
    1,
  );
  checks.push(
    "completion gate, metadata CSV provenance, refresh recovery and bounded active masks",
  );
  const dlPromise = page.waitForEvent("download");
  await page.locator("#export").click();
  const dl = await dlPromise,
    zip = path.join(output, "result.zip");
  await dl.saveAs(zip);
  await page.locator("#close-export").click();
  const validate = spawnSync(
    process.env.PYTHON || "python3",
    [
      "-c",
      `import sys,json;from pathlib import Path;sys.path.insert(0,${JSON.stringify(path.join(root, "src"))});from strawannotate.bundle import save_bundle;print(json.dumps(save_bundle(Path(sys.argv[1]).read_bytes(),Path(sys.argv[2]))))`,
      zip,
      path.join(output, "validated"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(validate.status, 0, validate.stderr);
  const result = JSON.parse(validate.stdout);
  assert.equal(result.completed, 2);
  assert.equal(result.drafts, 1);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(result.folder, "manifest.json")),
  );
  assert.deepEqual(manifest.records[0].statistics, expected);
  assert.equal(manifest.records[0].source.timestamp_sec, "0");
  assert.equal(manifest.records[0].source.source_video, "field, one.mp4");
  for (const r of manifest.records) {
    assert.deepEqual(
      fs.readFileSync(path.join(result.folder, r.image_path)),
      fs.readFileSync(path.join(output, r.original_file_name)),
    );
    const maskBytes = fs.readFileSync(
      path.join(result.folder, r.training_mask_path),
    );
    assert.equal(maskBytes[24], 8);
    assert.equal(maskBytes[25], 0);
    const mask = PNG.sync.read(maskBytes);
    assert.equal(mask.width, width);
    assert.equal(mask.height, height);
    assert(
      [...mask.data].every((v, i) =>
        i % 4 === 3 ? v === 255 : [0, 1, 255].includes(v),
      ),
    );
    assert.equal(
      r.training_mask_path.startsWith("training_masks/"),
      r.status === "completed",
    );
  }
  assert(!fs.existsSync(path.join(result.folder, "annotations.csv")));
  assert(
    fs
      .readFileSync(path.join(result.folder, "summary.csv"), "utf8")
      .includes("source_time_base"),
  );
  checks.push(
    "downloaded ZIP independently validated, exact source bytes, uint8 PNG targets, draft isolation and coverage",
  );
  await page.locator("#package-input").setInputFiles(zip);
  await page.waitForFunction(
    () =>
      session.imported_from_session_id &&
      current?.file_name === "synthetic_1.png" &&
      document.getElementById("busy").style.display === "none",
  );
  assert.deepEqual(await page.evaluate(() => count(current)), expected);
  assert.notEqual(await page.evaluate(() => session.id), originalSession);
  // Editing a completed label must revoke completion.
  await dot("255", 90, 20);
  assert.equal(await page.evaluate(() => current.status), "draft");
  assert.equal(await page.locator("#check-complete").isChecked(), false);
  await page.locator("#more").click();
  await page.locator("#sessions").selectOption(originalSession);
  await page.waitForFunction(
    (id) =>
      session.id === id &&
      !switching &&
      document.getElementById("busy").style.display === "none",
    originalSession,
  );
  await page.locator(".task").first().click();
  await page.waitForFunction(
    () => current?.file_name === "synthetic_1.png" && !switching,
  );
  assert.deepEqual(await page.evaluate(() => count(current)), expected);
  checks.push(
    "ZIP restoration creates separate batch; editing revokes completion; original batch intact",
  );
  // Large source batch must be rejected before modifying the task list.
  assert.match(
    await page.evaluate(async () => {
      try {
        await addFiles([{ name: "too_big.jpg", size: 129 * 1024 ** 2 }]);
        return "";
      } catch (e) {
        return e.message;
      }
    }),
    /128 MB/,
  );
  assert.equal(await page.evaluate(() => tasks.length), 3);
  await page.screenshot({
    path: path.join(output, "annotation-ui.png"),
    fullPage: true,
  });
  await page.locator("#more").click();
  await page.locator("#new-name").fill("NEXT_RATER");
  await page.locator("#new-session").click();
  await page.waitForFunction(
    () =>
      session.annotator === "NEXT_RATER" &&
      tasks.length === 0 &&
      document.getElementById("busy").style.display === "none",
  );
  assert.deepEqual(errors, []);
  checks.push("batch size preflight and empty new batch");
  console.log(
    JSON.stringify(
      { status: "passed", checks, output, synthetic_only: true },
      null,
      2,
    ),
  );
}
run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
