import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Paperclip, X, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

export type CampaignMedia = {
  url: string;
  path: string;
  type: "image" | "video" | "audio" | "document";
  mime: string;
  filename: string;
  size: number;
};

const MAX_SIZE = 30 * 1024 * 1024;
const LIMITS: Record<CampaignMedia["type"], { mimes: string[]; max: number }> = {
  image: { mimes: ["image/jpeg", "image/png", "image/webp", "image/gif"], max: MAX_SIZE },
  video: { mimes: ["video/mp4", "video/3gpp", "video/quicktime"], max: MAX_SIZE },
  audio: { mimes: ["audio/mpeg", "audio/mp3", "audio/ogg", "audio/aac", "audio/amr", "audio/wav"], max: MAX_SIZE },
  document: { mimes: ["application/pdf"], max: MAX_SIZE },
};

const ACCEPT = Object.values(LIMITS).flatMap((l) => l.mimes).join(",");

function detectType(mime: string): CampaignMedia["type"] | null {
  for (const t of Object.keys(LIMITS) as CampaignMedia["type"][]) {
    if (LIMITS[t].mimes.includes(mime)) return t;
  }
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function CampaignMediaPicker({
  value,
  onChange,
}: {
  value: CampaignMedia | null;
  onChange: (m: CampaignMedia | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const type = detectType(file.type);
    if (!type) {
      toast.error("Tipo de arquivo não suportado");
      return;
    }
    const limit = LIMITS[type];
    if (file.size > limit.max) {
      toast.error(`Arquivo maior que ${formatSize(limit.max)} para ${type}`);
      return;
    }

    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? "anon";
      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      const path = `${uid}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("campaign-media")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      const { data: pub } = supabase.storage.from("campaign-media").getPublicUrl(path);
      onChange({
        url: pub.publicUrl,
        path,
        type,
        mime: file.type,
        filename: file.name,
        size: file.size,
      });
      toast.success("Mídia anexada");
    } catch (err: any) {
      toast.error("Falha no upload: " + (err.message ?? "erro"));
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    if (!value) return;
    try {
      await supabase.storage.from("campaign-media").remove([value.path]);
    } catch {
      /* ignore */
    }
    onChange(null);
  }

  if (value) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 flex items-start gap-3">
        <div className="w-20 h-20 rounded bg-background border flex items-center justify-center overflow-hidden shrink-0">
          {value.type === "image" && (
            <img src={value.url} alt={value.filename} className="w-full h-full object-cover" />
          )}
          {value.type === "video" && (
            <video src={value.url} className="w-full h-full object-cover" muted />
          )}
          {value.type === "audio" && <Paperclip className="h-6 w-6 text-muted-foreground" />}
          {value.type === "document" && <FileText className="h-6 w-6 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{value.filename}</p>
          <p className="text-xs text-muted-foreground">
            {value.type} · {formatSize(value.size)}
          </p>
          {value.type === "audio" && (
            <audio src={value.url} controls className="mt-2 h-8 w-full max-w-xs" />
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={remove} className="text-destructive">
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={handleFile}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        ) : (
          <Paperclip className="h-4 w-4 mr-1" />
        )}
        {uploading ? "Enviando…" : "Anexar imagem, vídeo, áudio ou PDF"}
      </Button>
      <p className="text-xs text-muted-foreground mt-1">
        Imagem, vídeo, áudio ou PDF ≤30MB
      </p>
    </div>
  );
}
