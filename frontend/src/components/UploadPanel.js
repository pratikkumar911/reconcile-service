import { useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { UploadCloud, FileText, Loader2 } from "lucide-react";

function Dropzone({ label, testid, file, setFile }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);
  const onPick = (f) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      toast.error("Only .csv files are supported.");
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      toast.error("File too large (max 5MB).");
      return;
    }
    setFile(f);
  };
  return (
    <label
      data-testid={testid}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        onPick(e.dataTransfer.files?.[0]);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
        drag ? "border-slate-900 bg-slate-100" : "border-slate-300 bg-slate-50 hover:bg-slate-100"
      }`}
    >
      <input
        ref={ref}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
      {file ? (
        <>
          <FileText className="h-6 w-6 text-slate-700" />
          <div className="text-sm font-semibold text-slate-900">{file.name}</div>
          <div className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              ref.current.click();
            }}
          >
            Replace
          </Button>
        </>
      ) : (
        <>
          <UploadCloud className="h-6 w-6 text-slate-500" />
          <div className="text-sm font-semibold text-slate-800">{label}</div>
          <div className="text-xs text-slate-500">
            Drag & drop or{" "}
            <span
              className="underline"
              onClick={(e) => {
                e.preventDefault();
                ref.current.click();
              }}
            >
              browse
            </span>
          </div>
          <div className="text-xs text-slate-400">CSV, max 5MB</div>
        </>
      )}
    </label>
  );
}

export default function UploadPanel({ onCreated }) {
  const [ordersFile, setOrdersFile] = useState(null);
  const [paymentsFile, setPaymentsFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!ordersFile || !paymentsFile) {
      toast.error("Please choose both files.");
      return;
    }
    setBusy(true);
    const fd = new FormData();
    fd.append("orders_file", ordersFile);
    fd.append("payments_file", paymentsFile);
    try {
      const { data } = await api.post("/runs", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Reconciliation complete.");
      setOrdersFile(null);
      setPaymentsFile(null);
      onCreated?.(data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="upload-panel"
      className="rounded-lg border border-slate-200 bg-white p-6"
    >
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="font-display text-xl font-bold text-slate-900">
            New reconciliation run
          </h3>
          <p className="text-sm text-slate-600 mt-0.5">
            Upload your <span className="font-mono text-xs">orders.csv</span> and{" "}
            <span className="font-mono text-xs">payments.csv</span>. We'll match by{" "}
            <span className="font-mono text-xs">order_id</span> and flag every discrepancy.
          </p>
        </div>
        <Button
          data-testid="run-reconcile-btn"
          onClick={submit}
          disabled={busy || !ordersFile || !paymentsFile}
          className="bg-slate-900 hover:bg-slate-800"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Reconciling…
            </>
          ) : (
            "Reconcile"
          )}
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Dropzone
          label="Upload orders.csv"
          testid="drop-orders"
          file={ordersFile}
          setFile={setOrdersFile}
        />
        <Dropzone
          label="Upload payments.csv"
          testid="drop-payments"
          file={paymentsFile}
          setFile={setPaymentsFile}
        />
      </div>
      <div className="mt-3 text-xs text-slate-500">
        Required orders columns:{" "}
        <span className="font-mono">
          order_id, customer_email, order_date, gross_amount, discount, net_amount, currency, status
        </span>
        . Required payments columns:{" "}
        <span className="font-mono">
          payment_id, order_id, paid_amount, currency, payment_date, method, status
        </span>
        .
      </div>
    </div>
  );
}
