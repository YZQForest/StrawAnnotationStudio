"use strict";
const VERSION = "3.0.0",
  SCHEMA = "straw-annotation/2",
  $ = (id) => document.getElementById(id),
  enc = new TextEncoder(),
  dec = new TextDecoder();
let db,
  storageOk = true,
  session,
  tasks = [],
  current = null,
  bitmap = null,
  backend = null,
  catalog = [],
  selectedClass = "255",
  zoom = 1,
  showOverlay = true,
  space = false,
  gesture = null,
  undo = [],
  redo = [],
  saveTimer,
  toastTimer,
  renderPending = false,
  switching = false,
  unsaved = false;
const canvas = $("canvas"),
  ctx = canvas.getContext("2d"),
  overlayCanvas = document.createElement("canvas"),
  octx = overlayCanvas.getContext("2d");
const now = () => new Date().toISOString(),
  uid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
function message(text, error = false) {
  $("toast").textContent = text;
  $("toast").classList.toggle("error", error);
  $("toast").style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => ($("toast").style.display = "none"),
    error ? 10000 : 6000,
  );
}
async function work(text, fn) {
  $("busy-text").textContent = text;
  $("busy").style.display = "flex";
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    message(e.message || String(e), true);
  } finally {
    $("busy").style.display = "none";
  }
}
function safeId(name) {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[^\p{L}\p{N}_.-]/gu, "_")
      .slice(0, 140) || "image"
  );
}
async function sha(bytes) {
  if (!crypto.subtle)
    throw Error("此浏览器不支持安全哈希，请用桌面版 Chrome / Edge 打开。");
  const a = bytes instanceof Blob ? await bytes.arrayBuffer() : bytes;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", a))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function initDB() {
  try {
    db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("straw-pixel-annotation-v2", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("sessions", { keyPath: "id" });
        r.result.createObjectStore("tasks", { keyPath: "key" });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } catch {
    storageOk = false;
    $("storage-status").textContent = "自动保存不可用，请频繁备份 ZIP";
    message("浏览器存储不可用，请退出隐私模式并改用 Chrome / Edge。", true);
  }
}
async function get(store, key) {
  if (!db) return null;
  return request(db.transaction(store).objectStore(store).get(key));
}
async function put(store, value) {
  if (!db) throw Error("浏览器存储不可用");
  await new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
async function all(store) {
  if (!db) return [];
  return request(db.transaction(store).objectStore(store).getAll());
}
function newSession(name = "", role = "primary") {
  return {
    id: uid(),
    annotator: name,
    role,
    created_at: now(),
    updated_at: now(),
    identity_locked: false,
    catalog_project_id: backend?.project_id || null,
    task_descriptors: [],
    last_task: null,
  };
}
function release(t) {
  if (t && db && storageOk) {
    delete t.label;
    delete t.valid;
    delete t.blob;
  }
}
function descriptor(t) {
  const { label, valid, blob, statistics, ...d } = t;
  return d;
}
async function saveSession() {
  session.updated_at = now();
  session.task_descriptors = tasks.map(descriptor);
  session.last_task = current?.sample_id || null;
  await put("sessions", session);
  try {
    localStorage.setItem("straw-annotation-current-v2", session.id);
  } catch {}
}
let saveQueue = Promise.resolve();
async function saveCurrent() {
  clearTimeout(saveTimer);
  if (!session) return false;
  const task = current,
    activeSession = session;
  const job = async () => {
    try {
      if (task) {
        task.updated_at = now();
        await put("tasks", {
          key: activeSession.id + "/" + task.sample_id,
          task,
        });
      }
      await saveSession();
      storageOk = !!db;
      unsaved = false;
      $("save-status").textContent = storageOk
        ? "已自动保存 " +
          new Date().toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "请导出备份";
      return true;
    } catch (e) {
      storageOk = false;
      unsaved = true;
      $("save-status").textContent = "自动保存失败，请备份";
      message("保存失败：" + e.message + "。请立即导出数据包。", true);
      return false;
    }
  };
  const pending = saveQueue.then(job, job);
  saveQueue = pending;
  return pending;
}
function scheduleSave() {
  unsaved = true;
  $("save-status").textContent = "正在保存…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrent, 450);
}
async function refreshSessions() {
  const items = await all("sessions");
  $("sessions").replaceChildren();
  for (const s of items.sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )) {
    const op = document.createElement("option");
    op.value = s.id;
    op.textContent = `${s.annotator || "未填姓名"} · ${s.created_at.slice(0, 16).replace("T", " ")}`;
    $("sessions").append(op);
  }
  if (!items.some((s) => s.id === session.id)) {
    const op = document.createElement("option");
    op.value = session.id;
    op.textContent = "当前新工程";
    $("sessions").append(op);
  }
  $("sessions").value = session.id;
}
function setIdentity() {
  $("annotator").value = session.annotator;
  $("annotator").disabled = session.identity_locked;
  $("identity-hint").textContent = session.identity_locked
    ? "身份已锁定。换人请新建一批。"
    : "开始绘制后锁定身份；换标注者请新建一批。";
}
function allowEdit() {
  if (!current) return false;
  if (!session.annotator.trim()) {
    message("先填写标注者姓名或代号。", true);
    $("annotator").focus();
    return false;
  }
  session.identity_locked = true;
  setIdentity();
  current.status = "draft";
  current.completed_at = null;
  current.inspection = {
    ground_roi_checked: false,
    full_image_checked: false,
    human_annotation_confirmed: false,
  };
  syncInspection();
  return true;
}
function lockIdentity() {
  session.annotator = $("annotator").value.trim();
  scheduleSave();
  refreshSessions();
}
function count(t) {
  let n = 0,
    s = 0,
    u = 0,
    b = 0;
  for (let i = 0; i < t.label.length; i++)
    if (t.valid[i]) {
      n++;
      s += t.label[i] === 255;
      u += t.label[i] === 128;
      b += t.label[i] === 64;
    }
  return {
    valid_pixels: n,
    straw_pixels: s,
    uncertain_pixels: u,
    unmarked_pixels: b,
    excluded_pixels: t.label.length - n,
    coverage_lower_pp: n ? (100 * s) / n : null,
    coverage_upper_pp: n ? (100 * (s + u + b)) / n : null,
    coverage_pp: n && !u && !b ? (100 * s) / n : null,
  };
}
function updateStats() {
  if (!current) return;
  const s = count(current),
    fmt = (x) => (x === null ? "—" : x.toFixed(2) + "%");
  $("coverage").textContent =
    s.coverage_pp !== null
      ? fmt(s.coverage_pp)
      : s.valid_pixels
        ? `${s.coverage_lower_pp.toFixed(2)} – ${s.coverage_upper_pp.toFixed(2)}%`
        : "没有有效地面";
  $("live-coverage").textContent = $("coverage").textContent;
  $("straw-rate").textContent = fmt(s.coverage_lower_pp);
  $("uncertain-rate").textContent = fmt(
    s.valid_pixels ? (100 * s.uncertain_pixels) / s.valid_pixels : null,
  );
  $("unmarked-rate").textContent = fmt(
    s.valid_pixels ? (100 * s.unmarked_pixels) / s.valid_pixels : null,
  );
  $("excluded-rate").textContent = fmt(
    (100 * s.excluded_pixels) / current.label.length,
  );
  $("unmarked-message").textContent = !s.valid_pixels
    ? "没有有效地面"
    : s.unmarked_pixels
      ? `还有 ${((100 * s.unmarked_pixels) / s.valid_pixels).toFixed(1)}% 未标`
      : "地面已标完";
  $("stats-note").textContent =
    (current.source?.crop_box
      ? "这是裁块覆盖率，不能代表原始全图。"
      : "覆盖率仅代表当前影像有效地面。") +
    (s.unmarked_pixels
      ? " 仍有未标地面，不能标记完成。"
      : s.uncertain_pixels
        ? " 存在材料争议，保留区间。"
        : " 已知材料可计算单一数值。");
}
function refreshTasks() {
  const query = $("search").value.toLowerCase(),
    filter = $("filter").value;
  const done = tasks.filter((t) => t.status === "completed").length;
  $("progress").textContent = `${done} / ${tasks.length}`;
  $("tasks").replaceChildren();
  for (const t of tasks) {
    if (query && !t.file_name.toLowerCase().includes(query)) continue;
    if (
      (filter === "todo" && t.status === "completed") ||
      (filter === "completed" && t.status !== "completed")
    )
      continue;
    const b = document.createElement("button");
    b.className = "task" + (t === current ? " selected" : "");
    b.title = t.file_name;
    const n = document.createElement("span");
    n.className = "name";
    n.textContent =
      String(tasks.indexOf(t) + 1).padStart(2, "0") +
      " · " +
      (t.source?.segment || t.file_name);
    const detail = document.createElement("span");
    detail.className = "detail" + (t.status === "completed" ? " done" : "");
    detail.textContent =
      t.status === "completed"
        ? "✓ 已完成"
        : t.status === "draft"
          ? "● 草稿"
          : "○ 待开始";
    b.append(n, detail);
    b.onclick = () => selectTask(t.sample_id);
    $("tasks").append(b);
  }
}
function syncInspection() {
  const s = current?.inspection || {};
  $("check-complete").checked = [
    "ground_roi_checked",
    "full_image_checked",
    "human_annotation_confirmed",
  ].every((k) => s[k] === true);
  $("notes").value = current?.notes || "";
}
async function hydrate(t) {
  if (t.label && t.blob) return t;
  const saved = await get("tasks", session.id + "/" + t.sample_id);
  if (saved) {
    Object.assign(t, saved.task);
    t.source_bytes = t.blob.size;
    return t;
  }
  if (!t.blob) {
    const response = await fetch(t.url);
    if (!response.ok) throw Error("图片读取失败：" + t.file_name);
    t.blob = await response.blob();
  }
  t.source_bytes = t.blob.size;
  const hash = await sha(t.blob);
  if (t.image_sha256 && t.image_sha256 !== hash)
    throw Error("图片 SHA-256 不匹配，停止载入：" + t.file_name);
  t.image_sha256 = hash;
  const im = await createImageBitmap(t.blob, { imageOrientation: "none" });
  if (im.width * im.height > 40_000_000) {
    im.close();
    throw Error("图片超过 4000 万像素，请先制作原尺度裁块。");
  }
  t.width = im.width;
  t.height = im.height;
  im.close();
  t.label = new Uint8Array(t.width * t.height).fill(64);
  t.valid = new Uint8Array(t.label.length).fill(255);
  t.inspection = {};
  t.notes = "";
  t.status = "not_started";
  t.created_at = now();
  t.updated_at = t.created_at;
  return t;
}
async function selectTask(id) {
  if (switching) return;
  switching = true;
  try {
    endGesture();
    const previous = current;
    const saved = await saveCurrent();
    const task = tasks.find((t) => t.sample_id === id);
    if (!task) return;
    await hydrate(task);
    bitmap?.close();
    bitmap = await createImageBitmap(task.blob, { imageOrientation: "none" });
    current = task;
    if (saved && previous !== task) release(previous);
    reviewIndex = -1;
    $("review-position").textContent = "按原图像素放大检查细碎片";
    undo = [];
    redo = [];
    gesture = null;
    canvas.width = overlayCanvas.width = task.width;
    canvas.height = overlayCanvas.height = task.height;
    $("stage").style.display = "block";
    $("empty").style.display = "none";
    $("image-title").textContent =
      `${task.file_name} · ${task.width} × ${task.height}`;
    syncInspection();
    fit();
    updateStats();
    refreshTasks();
    await saveCurrent();
  } catch (e) {
    message(e.message, true);
  } finally {
    switching = false;
  }
}
function render() {
  if (!current || !bitmap) return;
  const w = current.width,
    h = current.height;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0);
  if (showOverlay) {
    const image = octx.createImageData(w, h),
      a = image.data,
      alpha = 107;
    for (let i = 0; i < current.label.length; i++) {
      const c = current.valid[i]
        ? current.label[i] === 255
          ? [24, 220, 115]
          : current.label[i] === 128
            ? [255, 166, 33]
            : current.label[i] === 64
              ? [58, 136, 247]
              : null
        : [65, 64, 80];
      if (c) {
        a[i * 4] = c[0];
        a[i * 4 + 1] = c[1];
        a[i * 4 + 2] = c[2];
        a[i * 4 + 3] = current.valid[i] ? alpha : 162;
      }
    }
    octx.putImageData(image, 0, 0);
    ctx.drawImage(overlayCanvas, 0, 0);
  }
}
function draw() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    render();
  });
}
function setZoom(value, anchor) {
  if (!current) return;
  const vp = $("viewport"),
    r = canvas.getBoundingClientRect(),
    ax = anchor?.[0] ?? vp.getBoundingClientRect().left + vp.clientWidth / 2,
    ay = anchor?.[1] ?? vp.getBoundingClientRect().top + vp.clientHeight / 2;
  const px = (ax - r.left) / zoom,
    py = (ay - r.top) / zoom;
  const vr = vp.getBoundingClientRect();
  zoom = Math.max(0.06, Math.min(12, value));
  canvas.style.width = Math.round(current.width * zoom) + "px";
  canvas.style.height = Math.round(current.height * zoom) + "px";
  $("zoom-level").textContent = Math.round(zoom * 100) + "%";
  $("stage").style.marginLeft =
    Math.max(20, (vp.clientWidth - Math.round(current.width * zoom)) / 2) +
    "px";
  vp.scrollLeft = $("stage").offsetLeft + px * zoom - (ax - vr.left);
  vp.scrollTop = 20 + py * zoom - (ay - vr.top);
  draw();
}
function fit() {
  if (current) {
    setZoom(
      Math.min(
        ($("viewport").clientWidth - 40) / current.width,
        ($("viewport").clientHeight - 40) / current.height,
        1,
      ),
    );
    $("viewport").scrollLeft = $("viewport").scrollTop = 0;
  }
}
function point(e) {
  const r = canvas.getBoundingClientRect();
  return [
    ((e.clientX - r.left) * current.width) / r.width,
    ((e.clientY - r.top) * current.height) / r.height,
  ];
}
function snapshot() {
  undo.push({ label: current.label.slice(), valid: current.valid.slice() });
  let bytes = undo.reduce((n, x) => n + x.label.length * 2, 0);
  while (undo.length > 30 || (bytes > 64 * 1024 * 1024 && undo.length > 1)) {
    bytes -= undo.shift().label.length * 2;
  }
  redo = [];
}
function write(i) {
  if (selectedClass === "exclude") current.valid[i] = 0;
  else if (selectedClass === "restore") current.valid[i] = 255;
  else {
    current.label[i] = Number(selectedClass);
    current.valid[i] = 255;
  }
}
function stamp(p) {
  const radius = Number($("brush-number").value) / 2,
    w = current.width,
    h = current.height;
  if (radius <= 0.5) {
    const x = Math.floor(p[0]),
      y = Math.floor(p[1]);
    if (x >= 0 && x < w && y >= 0 && y < h) write(y * w + x);
    return;
  }
  const x0 = Math.max(0, Math.floor(p[0] - radius)),
    x1 = Math.min(w - 1, Math.ceil(p[0] + radius)),
    y0 = Math.max(0, Math.floor(p[1] - radius)),
    y1 = Math.min(h - 1, Math.ceil(p[1] + radius));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if ((x + 0.5 - p[0]) ** 2 + (y + 0.5 - p[1]) ** 2 <= radius ** 2)
        write(y * w + x);
}
function stroke(from, to) {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]),
    steps = Math.max(
      1,
      Math.ceil(length / Math.max(0.5, Number($("brush-number").value) / 4)),
    );
  for (let s = 0; s <= steps; s++)
    stamp([
      from[0] + ((to[0] - from[0]) * s) / steps,
      from[1] + ((to[1] - from[1]) * s) / steps,
    ]);
}
function endEdit() {
  draw();
  updateStats();
  refreshTasks();
  scheduleSave();
}
function setClass(value) {
  selectedClass = String(value);
  document
    .querySelectorAll("[data-class]")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.class === selectedClass),
    );
  $("draw-hint").textContent =
    "画笔：" +
    {
      255: "秸秆",
      0: "背景 / 修正",
      128: "看不清的材料",
      exclude: "非地面遮挡",
      restore: "恢复有效地面",
      64: "擦回未标",
    }[selectedClass] +
    " · 空格拖动 · Ctrl/⌘+滚轮缩放";
}
canvas.addEventListener("pointerdown", (e) => {
  if (!current || switching || gesture || e.button !== 0) return;
  e.preventDefault();
  const p = point(e);
  if (space) {
    gesture = {
      type: "pan",
      start: [e.clientX, e.clientY],
      scroll: [$("viewport").scrollLeft, $("viewport").scrollTop],
    };
  } else {
    if (!allowEdit()) return;
    snapshot();
    gesture = { type: "brush", last: p };
    stamp(p);
    unsaved = true;
    draw();
  }
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!current) return;
  const c = $("brush-cursor");
  if (!space) {
    const d = Number($("brush-number").value) * zoom;
    c.style.display = "block";
    c.style.width = c.style.height = d + "px";
    c.style.left = e.clientX - d / 2 + "px";
    c.style.top = e.clientY - d / 2 + "px";
  } else c.style.display = "none";
  if (!gesture) return;
  if (gesture.type === "pan") {
    $("viewport").scrollLeft =
      gesture.scroll[0] - (e.clientX - gesture.start[0]);
    $("viewport").scrollTop =
      gesture.scroll[1] - (e.clientY - gesture.start[1]);
    return;
  }
  const p = point(e);
  stroke(gesture.last, p);
  gesture.last = p;
  draw();
});
function endGesture() {
  if (!gesture) return;
  const edited = gesture.type === "brush";
  gesture = null;
  if (edited) endEdit();
  else draw();
}
canvas.addEventListener("pointerup", (e) => {
  if (gesture?.type === "brush") {
    const p = point(e);
    stroke(gesture.last, p);
  }
  endGesture();
});
canvas.addEventListener("pointercancel", endGesture);
canvas.addEventListener("lostpointercapture", endGesture);
canvas.addEventListener(
  "pointerleave",
  () => ($("brush-cursor").style.display = "none"),
);
function historyMove(back) {
  if (!current) return;
  const from = back ? undo : redo,
    to = back ? redo : undo;
  if (!from.length) return;
  if (!allowEdit()) return;
  to.push({ label: current.label.slice(), valid: current.valid.slice() });
  const item = from.pop();
  current.label = item.label;
  current.valid = item.valid;
  endEdit();
}
async function move(delta) {
  if (!current) return;
  const i = tasks.indexOf(current);
  if (tasks[i + delta]) await selectTask(tasks[i + delta].sample_id);
}
function setSize(n) {
  n = Math.max(1, Math.min(240, Number(n) || 1));
  $("brush-number").value = n;
}
async function complete() {
  if (!current) return;
  if (!session.annotator.trim()) {
    message("请填写标注者。", true);
    return;
  }
  if (gesture) {
    message("请先完成或取消当前描绘。", true);
    return;
  }
  const s = count(current);
  if (!s.valid_pixels) {
    message("没有有效地面，请检查排除范围。", true);
    return;
  }
  if (s.unmarked_pixels) {
    message(
      `还有 ${s.unmarked_pixels.toLocaleString()} 个未标地面像素。请补标；也可先填背景后检查。`,
      true,
    );
    return;
  }
  if (!$("check-complete").checked) {
    message("检查整幅和地面范围后，勾选完成检查。", true);
    return;
  }
  session.identity_locked = true;
  setIdentity();
  current.status = "completed";
  current.completed_at = now();
  await saveCurrent();
  refreshTasks();
  const next = tasks.find(
    (t, i) => i > tasks.indexOf(current) && t.status !== "completed",
  );
  message("本幅已记录完成；导出时仍保留人工复核状态。");
  if (next) await selectTask(next.sample_id);
}
async function addFiles(files) {
  if (!db)
    throw Error("此浏览器无法保存进度，请使用非隐私模式的 Chrome / Edge。");
  const accepted = [...files].filter(
    (f) =>
      /\.(png|jpe?g)$/i.test(f.name) &&
      !/_mask\.png$|_valid\.png$/i.test(f.name),
  );
  if (!accepted.length) throw Error("请选择原图 PNG / JPG。");
  const existingBytes = tasks.reduce(
    (n, t) => n + (t.source_bytes || t.blob?.size || 0),
    0,
  );
  if (
    existingBytes + accepted.reduce((n, f) => n + f.size, 0) >
    128 * 1024 ** 2
  )
    throw Error(
      "本批原图合计超过 128 MB。请减少图片，当前批次完成导出后再新建一批。",
    );
  for (const file of accepted) {
    $("busy-text").textContent =
      `导入 ${accepted.indexOf(file) + 1} / ${accepted.length}（建议每批 20–50 张）`;
    const imageHash = await sha(file),
      existing = tasks.find((t) => t.image_sha256 === imageHash);
    if (existing) continue;
    const entry = catalog.find(
      (c) =>
        c.file_name.split("/").at(-1) === file.name &&
        c.image_sha256 === imageHash,
    );
    const sample_id =
      entry?.sample_id || `${safeId(file.name)}__${imageHash.slice(0, 12)}`;
    if (tasks.some((t) => t.sample_id === sample_id)) continue;
    const t = {
      sample_id,
      file_name: file.name,
      source_bytes: file.size,
      blob: file,
      image_sha256: imageHash,
      source: entry?.source || {
        original_file_name: file.name,
        relative_path: file.webkitRelativePath || file.name,
        source_provenance: "user_import",
        ground_group_independence_verified: false,
      },
      status: "not_started",
    };
    await hydrate(t);
    await put("tasks", { key: session.id + "/" + t.sample_id, task: t });
    tasks.push(t);
    release(t);
    await saveSession();
    refreshTasks();
  }
  await saveSession();
  refreshTasks();
  if (!current && tasks.length) await selectTask(tasks[0].sample_id);
  const metadata = [...files].filter((f) => f.name === "metadata.csv");
  if (metadata.length === 1) await attachProvenance(metadata[0]);
  message(`图片已导入，共 ${tasks.length} 项。`);
}
async function addCatalog(starterOnly) {
  for (const t of catalog) {
    if (starterOnly && !t.starter) continue;
    if (!tasks.some((x) => x.sample_id === t.sample_id))
      tasks.push({ ...t, status: "not_started" });
  }
  await saveSession();
  refreshTasks();
  if (!current && tasks.length) await selectTask(tasks[0].sample_id);
}
// CSV attachment preserves video/time provenance without guessing from filenames.
function parseCSV(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw Error("CSV 引号未闭合。");
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) throw Error("CSV 为空。");
  const keys = rows.shift();
  if (new Set(keys).size !== keys.length) throw Error("CSV 列名重复。");
  return rows.map((values) =>
    Object.fromEntries(keys.map((k, i) => [k, values[i] ?? ""])),
  );
}
async function attachProvenance(file) {
  if (file.size > 20 * 1024 ** 2) throw Error("来源清单过大。");
  const rows = parseCSV(await file.text()),
    byName = new Map();
  for (const r of rows) {
    const name = r.output_filename || r.original_file_name || r.file_name;
    if (!name) throw Error("清单需要 output_filename 列。");
    if (byName.has(name)) throw Error("清单图片名重复，无法可靠关联：" + name);
    byName.set(name, r);
  }
  const counts = new Map();
  for (const t of tasks)
    counts.set(t.file_name, (counts.get(t.file_name) || 0) + 1);
  const matches = tasks.filter((t) => byName.has(t.file_name));
  if (matches.some((t) => counts.get(t.file_name) > 1))
    throw Error("本批有同名图片，请分批后关联清单。");
  if (!matches.length) throw Error("清单文件名与本批图片不匹配，未修改来源。");
  await saveCurrent();
  for (const t of matches) {
    await hydrate(t);
    const row = byName.get(t.file_name);
    t.source = {
      ...t.source,
      source_provenance: "user_supplied_csv",
      source_metadata: row,
    };
    for (const key of [
      "frame_id",
      "run_id",
      "video_id",
      "source_video",
      "source_pts",
      "source_time_base",
      "timestamp_sec",
      "timestamp_definition",
      "ground_group_id",
    ])
      if (row[key] !== undefined) t.source[key] = row[key];
    await put("tasks", { key: session.id + "/" + t.sample_id, task: t });
    if (t !== current) release(t);
  }
  await saveSession();
  message(`已关联 ${matches.length} 张图片的来源；未匹配图片保留原来源。`);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc(a) {
  let n = 0xffffffff;
  for (const b of a) n = crcTable[(n ^ b) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
function concat(parts) {
  const a = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    a.set(p, pos);
    pos += p.length;
  }
  return a;
}
function be(n) {
  const a = new Uint8Array(4);
  new DataView(a.buffer).setUint32(0, n);
  return a;
}
function chunk(tag, data) {
  const t = enc.encode(tag);
  return concat([be(data.length), t, data, be(crc(concat([t, data])))]);
}
function storedZlib(raw) {
  const out = [new Uint8Array([0x78, 0x01])];
  for (let p = 0; p < raw.length; p += 65535) {
    const block = raw.subarray(p, Math.min(raw.length, p + 65535)),
      n = block.length;
    out.push(
      new Uint8Array([
        p + n === raw.length ? 1 : 0,
        n & 255,
        n >> 8,
        ~n & 255,
        (~n >> 8) & 255,
      ]),
      block,
    );
  }
  let a = 1,
    b = 0;
  for (const v of raw) {
    a = (a + v) % 65521;
    b = (b + a) % 65521;
  }
  out.push(be(((b << 16) | a) >>> 0));
  return concat(out);
}
async function pngGray(w, h, pixels) {
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++)
    raw.set(pixels.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  let compressed;
  if (typeof CompressionStream === "function")
    try {
      compressed = new Uint8Array(
        await new Response(
          new Blob([raw])
            .stream()
            .pipeThrough(new CompressionStream("deflate")),
        ).arrayBuffer(),
      );
    } catch {
      compressed = storedZlib(raw);
    }
  else compressed = storedZlib(raw);
  const head = new Uint8Array(13);
  head.set(be(w), 0);
  head.set(be(h), 4);
  head[8] = 8;
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", head),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array()),
  ]);
}
function zipStore(files) {
  let offset = 0;
  const locals = [],
    central = [];
  for (const [name, bytes] of files) {
    const fileName = enc.encode(name),
      crcValue = crc(bytes),
      header = new Uint8Array(30),
      d = new DataView(header.buffer);
    d.setUint32(0, 0x04034b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 0x800, true);
    d.setUint32(14, crcValue, true);
    d.setUint32(18, bytes.length, true);
    d.setUint32(22, bytes.length, true);
    d.setUint16(26, fileName.length, true);
    locals.push(header, fileName, bytes);
    const c = new Uint8Array(46),
      v = new DataView(c.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 20, true);
    v.setUint16(8, 0x800, true);
    v.setUint32(16, crcValue, true);
    v.setUint32(20, bytes.length, true);
    v.setUint32(24, bytes.length, true);
    v.setUint16(28, fileName.length, true);
    v.setUint32(42, offset, true);
    central.push(c, fileName);
    offset += header.length + fileName.length + bytes.length;
  }
  const length = central.reduce((n, a) => n + a.length, 0),
    end = new Uint8Array(22),
    v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, files.size, true);
  v.setUint16(10, files.size, true);
  v.setUint32(12, length, true);
  v.setUint32(16, offset, true);
  return new Blob([...locals, ...central, end], { type: "application/zip" });
}
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    files = new Map();
  let p = 0,
    total = 0;
  while (p + 30 <= bytes.length && view.getUint32(p, true) === 0x04034b50) {
    const flag = view.getUint16(p + 6, true),
      method = view.getUint16(p + 8, true),
      checksum = view.getUint32(p + 14, true),
      size = view.getUint32(p + 18, true),
      rawSize = view.getUint32(p + 22, true),
      nl = view.getUint16(p + 26, true),
      el = view.getUint16(p + 28, true),
      start = p + 30 + nl + el,
      name = dec.decode(bytes.subarray(p + 30, p + 30 + nl));
    if (method !== 0 || flag & 8 || size !== rawSize)
      throw Error("请导入本工具导出的未改动 ZIP；不支持外部重新压缩的包。");
    if (
      !name ||
      name.includes("..") ||
      name.includes("\\") ||
      name.startsWith("/") ||
      files.has(name) ||
      start + size > bytes.length
    )
      throw Error("包路径或长度不合法。");
    const content = bytes.slice(start, start + size);
    if (crc(content) !== checksum) throw Error("ZIP 文件校验失败：" + name);
    files.set(name, content);
    total += size;
    if (total > 2 * 1024 ** 3 || files.size > 20000)
      throw Error("包太大，请拆成多个标注批次。");
    p = start + size;
  }
  return files;
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}
function csvCell(v) {
  const x = String(v ?? "");
  return '"' + x.replaceAll('"', '""') + '"';
}
async function createBundle(includeDrafts = true) {
  if (!session.annotator.trim()) throw Error("请先填写标注者。");
  if (gesture) throw Error("先完成或取消当前描绘，再导出。");
  await saveCurrent();
  const chosen = tasks.filter((t) => includeDrafts || t.status === "completed");
  if (!chosen.length) throw Error("请先导入图片并标注。");
  const files = new Map(),
    records = [];
  let packageBytes = 0;
  for (let i = 0; i < chosen.length; i++) {
    const t = await hydrate(chosen[i]);
    if (packageBytes + t.blob.size > 256 * 1024 ** 2)
      throw Error(
        "本批原图和标签超过 256 MB，请分成较小批次导出。已有浏览器进度保留。",
      );
    $("busy-text").textContent = `准备数据包 ${i + 1} / ${chosen.length}`;
    const id = t.sample_id,
      done = t.status === "completed",
      prefix = done ? "human_masks" : "drafts";
    const label = t.label.slice(),
      valid = t.valid.slice(),
      training = new Uint8Array(label.length);
    for (let j = 0; j < label.length; j++) {
      if (!valid[j]) label[j] = 128;
      training[j] =
        !valid[j] || label[j] === 128 || label[j] === 64
          ? 255
          : label[j] === 255
            ? 1
            : 0;
    }
    const ext = /\.png$/i.test(t.file_name) ? "png" : "jpg",
      record = {
        sample_id: id,
        original_file_name: t.file_name,
        width: t.width,
        height: t.height,
        image_sha256: t.image_sha256,
        image_path: `images/${id}.${ext}`,
        mask_path: `${prefix}/${id}_mask.png`,
        valid_roi_path: `valid_roi/${id}_valid.png`,
        training_mask_path: `${done ? "training_masks" : "draft_training_masks"}/${id}.png`,
        metadata_path: `metadata/${id}.json`,
        source: t.source || {},
        annotator: session.annotator,
        annotation_role: session.role,
        session_id: session.id,
        status: done ? "completed" : "draft",
        label_origin: "human_annotation_or_manually_reviewed_import",
        tool_version: VERSION,
        created_at: t.created_at,
        updated_at: t.updated_at,
        completed_at: t.completed_at || null,
        inspection: t.inspection || {},
        inspection_confirmation_method:
          t.inspection_confirmation_method || "previous_tool_checklist",
        notes: t.notes || "",
        statistics: count(t),
        human_correctness_verified: false,
      };
    records.push(record);
    files.set(record.image_path, new Uint8Array(await t.blob.arrayBuffer()));
    files.set(record.mask_path, await pngGray(t.width, t.height, label));
    files.set(record.valid_roi_path, await pngGray(t.width, t.height, valid));
    files.set(
      record.training_mask_path,
      await pngGray(t.width, t.height, training),
    );
    files.set(
      record.metadata_path,
      enc.encode(JSON.stringify(record, null, 2)),
    );
    packageBytes = [...files.values()].reduce((n, a) => n + a.length, 0);
    if (t !== current) release(t);
    if (packageBytes > 256 * 1024 ** 2)
      throw Error("数据包超过 256 MB，请分批导出。");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  addSummary(files, records);
  const file_sha256 = {};
  for (const [name, data] of files) file_sha256[name] = await sha(data);
  const { task_descriptors, last_task, ...sessionMeta } = session;
  files.set(
    "manifest.json",
    enc.encode(
      JSON.stringify(
        {
          schema_version: SCHEMA,
          tool_version: VERSION,
          exported_at: now(),
          session: sessionMeta,
          label_encoding: {
            background: 0,
            straw: 255,
            uncertain: 128,
            draft_unmarked: 64,
          },
          valid_roi_encoding: { invalid: 0, valid: 255 },
          training_encoding: { background: 0, straw: 1, ignore: 255 },
          records,
          file_sha256,
        },
        null,
        2,
      ),
    ),
  );
  return zipStore(files);
}
async function exportBundle(drafts) {
  const blob = await createBundle(drafts);
  if (backend) {
    $("busy-text").textContent = "本机校验并保存…";
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          "X-Annotation-Token": backend.token,
        },
        body: blob,
      });
      const result = await res.json();
      if (!res.ok) throw Error(result.error || "本机保存失败");
      message(
        `已校验保存：${result.folder}（完成 ${result.completed}，草稿 ${result.drafts}）`,
      );
      $("save-status").textContent = "研究包已保存";
      showExport(result.folder, result.completed, result.drafts);
      return result;
    } catch (e) {
      download(
        blob,
        `straw_annotations_${session.id.slice(0, 8)}_${Date.now()}.zip`,
      );
      throw Error("本机保存失败，已下载 ZIP 备用：" + e.message);
    }
  }
  download(
    blob,
    `straw_annotations_${session.id.slice(0, 8)}_${Date.now()}.zip`,
  );
  showExport(
    "浏览器下载目录中的 ZIP 文件",
    tasks.filter((t) => t.status === "completed").length,
    drafts ? tasks.filter((t) => t.status !== "completed").length : 0,
  );
}
async function decodePlane(bytes, w, h, allowed) {
  const im = await createImageBitmap(new Blob([bytes], { type: "image/png" }), {
    imageOrientation: "none",
  });
  if (im.width !== w || im.height !== h) {
    im.close();
    throw Error("掩码尺寸与原图不同。");
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const cx = c.getContext("2d", { willReadFrequently: true });
  cx.drawImage(im, 0, 0);
  im.close();
  const rgba = cx.getImageData(0, 0, w, h).data,
    out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const j = i * 4;
    if (
      rgba[j] !== rgba[j + 1] ||
      rgba[j] !== rgba[j + 2] ||
      rgba[j + 3] !== 255 ||
      !allowed.includes(rgba[j])
    )
      throw Error("掩码必须是指定整数灰度值且无透明像素。");
    out[i] = rgba[j];
  }
  return out;
}
async function importBundle(file) {
  if (file.size > 256 * 1024 ** 2)
    throw Error("数据包超过 256 MB。请用旧版恢复后分批迁移。");
  const files = readZip(new Uint8Array(await file.arrayBuffer())),
    m = JSON.parse(dec.decode(files.get("manifest.json") || new Uint8Array()));
  if (m.schema_version !== SCHEMA) throw Error("不是 v2 研究数据包。");
  const declared = Object.keys(m.file_sha256 || {});
  if (declared.length !== files.size - 1 || declared.some((n) => !files.has(n)))
    throw Error("数据包文件声明不完整。");
  for (const [name, hash] of Object.entries(m.file_sha256)) {
    if ((await sha(files.get(name))) !== hash)
      throw Error("SHA-256 不匹配：" + name);
  }
  if (
    !m.session?.annotator ||
    !["primary", "independent_repeat", "adjudication"].includes(
      m.session.role,
    ) ||
    !m.records?.length
  )
    throw Error("数据包缺少标注者、类型或记录。");
  if (!db) throw Error("浏览器存储不可用，无法安全恢复。");
  await saveCurrent();
  const imported = [],
    ids = new Set(),
    stagedId = uid(),
    stagedKeys = [];
  try {
    for (const r of m.records) {
      if (
        !Number.isInteger(r.width) ||
        !Number.isInteger(r.height) ||
        r.width <= 0 ||
        r.height <= 0 ||
        r.width * r.height > 40_000_000
      )
        throw Error("数据包图片尺寸不受支持。");
      if (
        typeof r.sample_id !== "string" ||
        !r.sample_id ||
        /[\\/:]/.test(r.sample_id) ||
        r.sample_id.includes("..")
      )
        throw Error("无效图片 ID。");
      if (
        r.annotator !== m.session.annotator ||
        r.annotation_role !== m.session.role ||
        r.session_id !== m.session.id
      )
        throw Error("单图标注者或工程身份不一致。");
      if (ids.has(r.sample_id)) throw Error("任务 ID 重复。");
      ids.add(r.sample_id);
      if (
        JSON.stringify(JSON.parse(dec.decode(files.get(r.metadata_path)))) !==
        JSON.stringify(r)
      )
        throw Error("单图记录与清单不同。");
      const bytes = files.get(r.image_path);
      if ((await sha(bytes)) !== r.image_sha256) throw Error("原图哈希不同。");
      const blob = new Blob([bytes], {
          type: /\.png$/i.test(r.image_path) ? "image/png" : "image/jpeg",
        }),
        im = await createImageBitmap(blob, { imageOrientation: "none" });
      if (im.width !== r.width || im.height !== r.height) {
        im.close();
        throw Error("原图尺寸与记录不同。");
      }
      im.close();
      const label = await decodePlane(
          files.get(r.mask_path),
          r.width,
          r.height,
          [0, 64, 128, 255],
        ),
        valid = await decodePlane(
          files.get(r.valid_roi_path),
          r.width,
          r.height,
          [0, 255],
        ),
        training = await decodePlane(
          files.get(r.training_mask_path),
          r.width,
          r.height,
          [0, 1, 255],
        );
      for (let i = 0; i < label.length; i++)
        if (
          training[i] !==
          (!valid[i] || label[i] === 64 || label[i] === 128
            ? 255
            : label[i] === 255
              ? 1
              : 0)
        )
          throw Error("训练掩码映射错误。");
      const task = {
        ...r,
        file_name: r.original_file_name,
        label,
        valid,
        blob,
      };
      const stats = count(task);
      for (const [k, v] of Object.entries(stats))
        if (
          v === null
            ? r.statistics[k] !== null
            : !Number.isFinite(r.statistics[k]) ||
              Math.abs(v - r.statistics[k]) > 1e-6
        )
          throw Error("覆盖率统计与掩码不符。");
      if (!["completed", "draft"].includes(r.status))
        throw Error("未知完成状态。");
      if (
        r.status === "completed" &&
        (!stats.valid_pixels ||
          stats.unmarked_pixels ||
          ![
            "ground_roi_checked",
            "full_image_checked",
            "human_annotation_confirmed",
          ].every((k) => r.inspection?.[k]))
      )
        throw Error("完成状态缺少检查或仍有未标地面。");
      // Stage into a new namespace; a validation/storage error never replaces the active batch.
      const key = stagedId + "/" + task.sample_id;
      await put("tasks", { key, task });
      stagedKeys.push(key);
      imported.push(descriptor({ ...task, source_bytes: blob.size }));
    }
  } catch (error) {
    const tx = db.transaction("tasks", "readwrite");
    for (const key of stagedKeys) tx.objectStore("tasks").delete(key);
    throw error;
  }
  const importedSession = {
    ...m.session,
    id: stagedId,
    imported_from_session_id: m.session.id,
    catalog_project_id: backend?.project_id || null,
    identity_locked: true,
  };
  session = importedSession;
  tasks = imported;
  current = null;
  await saveSession();
  setIdentity();
  refreshTasks();
  await refreshSessions();
  await selectTask(tasks[0].sample_id);
  message("数据包校验通过，已恢复为一个独立工程；原工程保留。");
}
$("import-source").onclick = () => {
  $("more-dialog").close();
  $("source-input").click();
};
$("source-input").onchange = async (e) => {
  if (e.target.files[0])
    await work("关联抽帧来源…", () => attachProvenance(e.target.files[0]));
  e.target.value = "";
};
$("quick-import").onclick = () => $("image-input").click();
$("quick-folder").onclick = () => $("folder-input").click();
for (const id of ["image-input", "folder-input"])
  $(id).onchange = async (e) => {
    const files = [...e.target.files];
    await work("导入图片…", () => addFiles(files));
    e.target.value = "";
  };
$("import-package").onclick = () => {
  $("more-dialog").close();
  $("package-input").click();
};
$("package-input").onchange = async (e) => {
  if (e.target.files[0])
    await work("校验并恢复…", () => importBundle(e.target.files[0]));
  e.target.value = "";
};
$("export").onclick = () => work("导出全部进度…", () => exportBundle(true));
$("annotator").onchange = lockIdentity;
for (const id of ["search", "filter"]) $(id).oninput = refreshTasks;
document.querySelectorAll("[data-class]").forEach(
  (b) =>
    (b.onclick = () => {
      setClass(b.dataset.class);
      if ($("more-dialog").open) $("more-dialog").close();
    }),
);
$("brush-number").onchange = (e) => setSize(e.target.value);
$("undo").onclick = () => historyMove(true);
$("redo").onclick = () => historyMove(false);
$("zoom-in").onclick = () => setZoom(zoom * 1.35);
$("zoom-out").onclick = () => setZoom(zoom / 1.35);
$("fit").onclick = fit;
$("overlay").onclick = () => {
  showOverlay = !showOverlay;
  $("overlay").textContent = showOverlay ? "看原图" : "看标注";
  draw();
};
$("fill-background").onclick = () => {
  if (!current || !allowEdit()) return;
  snapshot();
  for (let i = 0; i < current.label.length; i++)
    if (current.valid[i] && current.label[i] === 64) current.label[i] = 0;
  endEdit();
  message("只将未标区域填为背景。请检查是否漏标细碎秸秆。");
};
$("prev").onclick = () => move(-1);
$("next").onclick = () => move(1);
$("complete").onclick = complete;
$("check-complete").onchange = () => {
  if (!current) return;
  const checked = $("check-complete").checked;
  current.inspection = {
    ground_roi_checked: checked,
    full_image_checked: checked,
    human_annotation_confirmed: checked,
  };
  current.inspection_confirmation_method = "combined_checklist";
  if (!checked) {
    current.status = "draft";
    current.completed_at = null;
  }
  refreshTasks();
  scheduleSave();
};
$("notes").oninput = () => {
  if (current) {
    current.notes = $("notes").value;
    scheduleSave();
  }
};
$("new-session").onclick = async () => {
  const name = $("new-name").value.trim();
  if (!name) {
    message("请填写新批次的标注者。", true);
    return;
  }
  if (
    !confirm(
      "建议先导出当前数据包。新批次从空白开始，当前批次保留在此浏览器，可在“进度与帮助”切回。继续？",
    )
  )
    return;
  await work("创建新批次…", async () => {
    if (!(await saveCurrent()))
      throw Error("当前进度未保存，请先导出数据包，再新建一批。");
    session = newSession(name);
    tasks = [];
    current = null;
    bitmap?.close();
    bitmap = null;
    undo = [];
    redo = [];
    setIdentity();
    await saveSession();
    await refreshSessions();
    refreshTasks();
    $("stage").style.display = "none";
    $("empty").style.display = "block";
    $("image-title").textContent = "新批次，请导入图片";
    $("coverage").textContent = $("live-coverage").textContent = "—";
    $("check-complete").checked = false;
    $("more-dialog").close();
  });
};
$("sessions").onchange = async () => {
  const target = $("sessions").value;
  $("more-dialog").close();
  await work("恢复批次…", async () => {
    if (!(await saveCurrent()))
      throw Error("当前进度未保存，请先导出数据包，再切换批次。");
    release(current);
    session = await get("sessions", target);
    if (!session) throw Error("批次不存在。");
    tasks = session.task_descriptors || [];
    current = null;
    bitmap?.close();
    bitmap = null;
    setIdentity();
    refreshTasks();
    await refreshSessions();
    $("stage").style.display = "none";
    $("empty").style.display = "block";
    if (tasks.length) await selectTask(session.last_task || tasks[0].sample_id);
  });
};
$("viewport").addEventListener(
  "wheel",
  (e) => {
    if ((e.ctrlKey || e.metaKey) && current) {
      e.preventDefault();
      setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), [e.clientX, e.clientY]);
    }
  },
  { passive: false },
);
document.addEventListener("keydown", (e) => {
  if (
    /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) ||
    $("more-dialog").open ||
    $("export-dialog").open ||
    $("busy").style.display === "flex"
  )
    return;
  const k = e.key.toLowerCase();
  if (e.code === "Space") {
    space = true;
    e.preventDefault();
    canvas.style.cursor = "grab";
    return;
  }
  if ((e.metaKey || e.ctrlKey) && k === "z") {
    e.preventDefault();
    if (!gesture) historyMove(!e.shiftKey);
    return;
  }
  if ((e.metaKey || e.ctrlKey) && k === "s") {
    e.preventDefault();
    saveCurrent();
    return;
  }
  if (gesture) return;
  if (k === "tab") {
    e.preventDefault();
    $("overlay").click();
  } else if (["0", "1", "2", "3", "4", "5"].includes(k))
    setClass(
      { 0: "64", 1: "255", 2: "0", 3: "128", 4: "exclude", 5: "restore" }[k],
    );
  else if (k === "+" || k === "=") setZoom(zoom * 1.35);
  else if (k === "-") setZoom(zoom / 1.35);
  else if (k === "[") setSize(Number($("brush-number").value) - 2);
  else if (k === "]") setSize(Number($("brush-number").value) + 2);
  else if (k === "arrowright") {
    e.preventDefault();
    move(1);
  } else if (k === "arrowleft") {
    e.preventDefault();
    move(-1);
  }
});
document.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    space = false;
    canvas.style.cursor = "crosshair";
  }
});
window.addEventListener("blur", () => {
  space = false;
  endGesture();
});
window.addEventListener("beforeunload", (e) => {
  if (unsaved) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function boot() {
  await initDB();
  if (location.protocol !== "file:")
    try {
      const r = await fetch("/api/catalog");
      if (r.ok) {
        const data = await r.json();
        if (data.token && Array.isArray(data.samples)) {
          backend = data;
          catalog = data.samples;
        }
      }
    } catch {}
  let last;
  try {
    last = localStorage.getItem("straw-annotation-current-v2");
  } catch {}
  session = last ? await get("sessions", last) : null;
  if (!session) session = newSession();
  if (
    backend &&
    session.catalog_project_id &&
    session.catalog_project_id !== backend.project_id
  )
    session = newSession();
  if (backend) session.catalog_project_id = backend.project_id;
  tasks = session.task_descriptors || [];
  setIdentity();
  refreshTasks();
  await refreshSessions();
  if (tasks.length) await selectTask(session.last_task || tasks[0].sample_id);
  else if (catalog.length) await addCatalog(false);
  else await saveSession();
}
$("more").onclick = () => {
  refreshSessions();
  $("more-dialog").showModal();
};
$("close-more").onclick = () => $("more-dialog").close();

let reviewIndex = -1;
function reviewTile(step) {
  if (!current) return;
  const cols = Math.ceil(current.width / 512),
    rows = Math.ceil(current.height / 512),
    total = cols * rows;
  reviewIndex = Math.max(0, Math.min(total - 1, reviewIndex + step));
  const x = (reviewIndex % cols) * 512,
    y = Math.floor(reviewIndex / cols) * 512,
    vp = $("viewport");
  const w = Math.min(512, current.width - x),
    h = Math.min(512, current.height - y);
  setZoom(
    Math.max(
      1,
      Math.min((vp.clientWidth - 40) / w, (vp.clientHeight - 40) / h, 4),
    ),
  );
  vp.scrollLeft = $("stage").offsetLeft + x * zoom;
  vp.scrollTop = 20 + y * zoom;
  $("review-position").textContent =
    `第 ${reviewIndex + 1} / ${total} 格 · 导航不代表已核验`;
}
function addSummary(files, records) {
  const cols = [
    "sample_id",
    "original_file_name",
    "status",
    "coverage_pp",
    "coverage_lower_pp",
    "coverage_upper_pp",
    "uncertain_pixels",
    "image_path",
    "training_mask_path",
    "video_id",
    "frame_id",
    "timestamp_sec",
    "source_pts",
    "source_time_base",
    "run_id",
  ];
  const lines = [cols.join(",")];
  for (const r of records)
    lines.push(
      cols
        .map((k) => csvCell(r[k] ?? r.statistics[k] ?? r.source?.[k] ?? ""))
        .join(","),
    );
  files.set("summary.csv", enc.encode("\ufeff" + lines.join("\r\n")));
  files.set(
    "START_HERE.txt",
    enc.encode(
      "先看 summary.csv：每行一幅图，coverage_pp 为百分数；只使用 completed 行。空值表示有争议或未标，不是零。\n训练读取 images + training_masks，标签 0=背景、1=秸秆、255=忽略。仅用 completed；保留 ROI，勿用忽略后分母替代有效地面分母。\nhuman_masks 为人工材料标签，valid_roi 为有效地面；metadata / manifest 保留全部来源及标注记录。时序实验使用 video_id、帧号和时间；缺失来源不推断，重复地面仍需人工分组。\n备份包的 draft 项不能作为正式标签。请保留整个 ZIP，可在工具中恢复。\n",
    ),
  );
}
function showExport(location, completed, drafts) {
  $("export-location").textContent = location;
  $("export-count").textContent =
    `已导出 ${completed} 幅完成项` + (drafts ? `，另含 ${drafts} 幅草稿` : "");
  $("export-dialog").showModal();
}
$("close-export").onclick = () => $("export-dialog").close();
$("quick-import").onclick = () => $("image-input").click();
$("quick-folder").onclick = () => $("folder-input").click();
$("review-next").onclick = () => reviewTile(1);
$("review-prev").onclick = () => reviewTile(-1);

boot().catch((e) => message("初始化失败：" + e.message, true));
