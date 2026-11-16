import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileImage, FileVideo, FolderOpen, Loader2, RefreshCw, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type UploadItem = { id: string; object_path: string; original_name: string; content_type: string; file_size: number; captured_at: string | null; uploaded_at: string; status: string };
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const safeName = (name: string) => name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(-120) || "upload";

export function FileUploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [fatherAccess, setFatherAccess] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: queryError } = await (supabase as any).from("file_upload_items")
      .select("id,object_path,original_name,content_type,file_size,captured_at,uploaded_at,status")
      .order("uploaded_at", { ascending: false }).limit(200);
    if (queryError) setError(queryError.message.includes("file_upload_items") ? "The File Upload database table is missing. Check the Supabase migration." : "Could not load the private media library. Check the father account's database permissions.");
    else setItems((data ?? []) as UploadItem[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!alive) return;
      setFatherAccess(data.user?.email?.toLowerCase() === "tim@popotso.app");
      setAccessChecked(true);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!fatherAccess) return;
    void refresh();
    const channel = supabase.channel("private-file-upload-library").on("postgres_changes", { event: "*", schema: "public", table: "file_upload_items" }, () => void refresh()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, fatherAccess]);

  const uploadFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length || uploading) return;
    setError("");
    setNotice("");
    const invalid = files.find(file => !file.type.startsWith("image/") && !file.type.startsWith("video/"));
    if (invalid) { setError(`“${invalid.name}” is not an image or video. Select photos or videos only.`); return; }
    const tooLarge = files.find(file => file.size > MAX_FILE_SIZE);
    if (tooLarge) { setError(`“${tooLarge.name}” exceeds the 50 MB per-file limit.`); return; }

    setUploading(true);
    let completed = 0;
    const userResult = await supabase.auth.getUser();
    const userId = userResult.data.user?.id;
    if (userResult.error || !userId || userResult.data.user?.email?.toLowerCase() !== "tim@popotso.app") {
      setError("Only the father account can upload to this library.");
      setUploading(false);
      return;
    }

    for (const file of files) {
      const objectPath = `${userId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName(file.name)}`;
      setUploadProgress(`Uploading ${completed + 1} of ${files.length}: ${file.name}`);
      const { error: storageError } = await supabase.storage.from("file-upload").upload(objectPath, file, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: false,
      });
      if (storageError) {
        setError(`Could not upload “${file.name}”: ${storageError.message}. Check the father-only Storage INSERT policy.`);
        break;
      }

      const { error: rowError } = await (supabase as any).from("file_upload_items").insert({
        device_id: "father-browser",
        object_path: objectPath,
        original_name: file.name,
        content_type: file.type,
        file_size: file.size,
        captured_at: new Date(file.lastModified).toISOString(),
        status: "synced",
        metadata: { source: "manual-browser-upload" },
      });
      if (rowError) {
        await supabase.storage.from("file-upload").remove([objectPath]);
        setError(`The file uploaded but its library record could not be saved: ${rowError.message}. Check the father-only database INSERT policy.`);
        break;
      }
      completed += 1;
    }
    setUploading(false);
    setUploadProgress("");
    if (completed) setNotice(`${completed} file${completed === 1 ? "" : "s"} added to your private library.`);
    await refresh();
    if (inputRef.current) inputRef.current.value = "";
  };

  const download = async (item: UploadItem) => {
    setDownloading(item.id);
    setError("");
    const { data, error: signedError } = await supabase.storage.from("file-upload").createSignedUrl(item.object_path, 60);
    if (signedError || !data?.signedUrl) setError("This file could not be opened. Refresh and try again.");
    else {
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = item.original_name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setDownloading(null);
  };

  if (!accessChecked || !fatherAccess) return null;

  return <section className="mb-4 rounded-2xl border border-border bg-card p-4" aria-label="File Upload">
    <div className="mb-3 flex items-center justify-between gap-3">
      <div><h3 className="font-semibold">File Upload</h3><p className="mt-0.5 text-xs text-muted-foreground">Private family media library · Father access only</p></div>
      <button onClick={() => void refresh()} disabled={loading || uploading} aria-label="Refresh File Upload" className="rounded-full p-2 hover:bg-secondary disabled:opacity-50">{loading ? <Loader2 className="size-4 animate-spin"/> : <RefreshCw className="size-4"/>}</button>
    </div>

    <input ref={inputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={event => { if (event.target.files) void uploadFiles(event.target.files); }}/>
    <div className="mb-3 grid grid-cols-2 gap-2">
      <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><FolderOpen className="size-4"/>Browse Files</button>
      <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-secondary px-3 py-2 text-sm font-semibold disabled:opacity-50"><Upload className="size-4"/>Add Photos / Videos</button>
    </div>
    <p className="mb-3 text-[11px] text-muted-foreground">Choose photos or videos from this device. Maximum 50 MB per file. Uploads are manual; this web app does not silently scan or sync another phone's gallery.</p>

    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{["Sync Active", "Syncing...", "Sync Paused", "Permission", "LS Success", "attachment synced"].map(label => <div key={label} className="rounded-xl border border-border bg-secondary/50 px-2 py-2 text-center text-xs font-medium">{label}</div>)}</div>
    {uploading && <div className="mb-3 flex items-center gap-2 rounded-xl bg-primary/10 p-3 text-xs text-primary" role="status"><Loader2 className="size-4 animate-spin"/><span className="min-w-0 flex-1 truncate">{uploadProgress}</span></div>}
    {notice && <div className="mb-3 flex items-start gap-2 rounded-xl bg-emerald-500/10 p-3 text-xs text-emerald-700"><span className="flex-1">{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss message"><X className="size-4"/></button></div>}
    {error && <p role="alert" className="mb-3 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">{error}</p>}

    <div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-semibold">Your files</h4><span className="text-xs text-muted-foreground">{items.length} items</span></div>
    {loading ? <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>Loading library…</div>
      : items.length === 0 ? <div className="rounded-xl border border-dashed border-border bg-secondary/30 px-3 py-6 text-center"><FolderOpen className="mx-auto mb-2 size-7 text-muted-foreground"/><p className="text-sm font-medium">Your library is empty</p><p className="mt-1 text-xs text-muted-foreground">Use Browse Files to add photos and videos from this device.</p></div>
      : <div className="max-h-80 space-y-2 overflow-y-auto">{items.map(item => <div key={item.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">{item.content_type.startsWith("video/") ? <FileVideo className="size-5"/> : <FileImage className="size-5"/>}</div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.original_name}</p><p className="text-xs text-muted-foreground">{formatSize(Number(item.file_size))} · {new Date(item.uploaded_at).toLocaleDateString()}</p></div>
        <button onClick={() => void download(item)} disabled={downloading === item.id} aria-label={`Download ${item.original_name}`} className="rounded-lg bg-primary p-2 text-primary-foreground disabled:opacity-50">{downloading === item.id ? <Loader2 className="size-4 animate-spin"/> : <Download className="size-4"/>}</button>
      </div>)}</div>}
  </section>;
}
