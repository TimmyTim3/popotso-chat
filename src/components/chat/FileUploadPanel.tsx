import { useCallback, useEffect, useState } from "react";
import { Download, FileImage, FileVideo, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type UploadItem = { id: string; object_path: string; original_name: string; content_type: string; file_size: number; captured_at: string | null; uploaded_at: string; status: string };
const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function FileUploadPanel() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [parentAccess, setParentAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    const { data, error: queryError } = await (supabase as any).from("file_upload_items")
      .select("id,object_path,original_name,content_type,file_size,captured_at,uploaded_at,status")
      .order("uploaded_at", { ascending: false }).limit(200);
    if (queryError) setError(queryError.message.includes("file_upload_items") ? "File Upload storage is not set up yet. Apply the new Supabase migration." : "Could not load the private media library. Check parent account access.");
    else setItems((data ?? []) as UploadItem[]);
    setLoading(false);
  }, []);
  useEffect(() => {
    let alive = true;
    void supabase.auth.getUser().then(({ data }) => {
      const email = data.user?.email?.toLowerCase();
      if (alive) setParentAccess(email === "tim@popotso.app" || email === "mother@popotso.app");
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!parentAccess) return;
    void refresh();
    const channel = supabase.channel("private-file-upload-library").on("postgres_changes", { event: "*", schema: "public", table: "file_upload_items" }, () => void refresh()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, parentAccess]);
  const download = async (item: UploadItem) => {
    setDownloading(item.id);
    const { data, error: signedError } = await supabase.storage.from("file-upload").createSignedUrl(item.object_path, 60);
    if (signedError || !data?.signedUrl) setError("This file could not be opened. Refresh and try again.");
    else { const a = document.createElement("a"); a.href = data.signedUrl; a.download = item.original_name; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); }
    setDownloading(null);
  };
  if (!parentAccess) return null;

  return <section className="mb-4 rounded-2xl border border-border bg-card p-4" aria-label="File Upload">
    <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="font-semibold">File Upload</h3><p className="mt-0.5 text-xs text-muted-foreground">Private family media library</p></div>
      <button onClick={() => void refresh()} disabled={loading} aria-label="Refresh File Upload" className="rounded-full p-2 hover:bg-secondary disabled:opacity-50">{loading ? <Loader2 className="size-4 animate-spin"/> : <RefreshCw className="size-4"/>}</button></div>
    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{["Sync Active", "Syncing...", "Sync Paused", "Permission", "LS Success", "attachment synced"].map(label => <div key={label} className="rounded-xl border border-border bg-secondary/50 px-2 py-2 text-center text-xs font-medium">{label}</div>)}</div>
    {error && <p role="alert" className="mb-3 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">{error}</p>}
    {loading ? <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>Loading library…</div>
      : items.length === 0 ? <p className="rounded-xl bg-secondary/40 px-3 py-5 text-center text-sm text-muted-foreground">No synced files yet.</p>
      : <div className="max-h-80 space-y-2 overflow-y-auto">{items.map(item => <div key={item.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">{item.content_type.startsWith("video/") ? <FileVideo className="size-5"/> : <FileImage className="size-5"/>}</div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.original_name}</p><p className="text-xs text-muted-foreground">{formatSize(item.file_size)} · {new Date(item.uploaded_at).toLocaleDateString()}</p></div>
        <button onClick={() => void download(item)} disabled={downloading === item.id} aria-label={`Download ${item.original_name}`} className="rounded-lg bg-primary p-2 text-primary-foreground disabled:opacity-50">{downloading === item.id ? <Loader2 className="size-4 animate-spin"/> : <Download className="size-4"/>}</button>
      </div>)}</div>}
  </section>;
}
